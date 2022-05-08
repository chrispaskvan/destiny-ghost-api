/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
const _ = require('lodash');
const jsonpatch = require('rfc6902');
const Postmaster = require('../helpers/postmaster');
const tokens = require('../helpers/tokens');

/**
 * @constant
 * @type {string}
 * @description Postmaster Vendor Number
 */
const postmasterHash = '2021251983';

/**
 * Time To Live for Tokens
 * @type {number}
 */
const ttl = 300;

/**
 * User Controller Class
 */
class UserController {
    constructor(options = {}) {
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.postmaster = new Postmaster();
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Get the phone number format into the Twilio standard.
     *
     * @param phoneNumber
     * @returns {string}
     * @private
     */
    static #cleanPhoneNumber(phoneNumber) {
        const cleaned = phoneNumber.replace(/\D/g, '');

        return `+1${cleaned}`;
    }

    /**
     * Get current epoch.
     *
     * @returns {number}
     * @private
     */
    static #getEpoch() {
        return Math.floor((new Date()).getTime() / 1000);
    }

    /**
     * Hypermedia as the Engine of Application State (HATEOAS)
     *
     * @param dateRegistered
     * @param displayName
     * @param emailAddress
     * @param firstName
     * @param lastName
     * @param membershipType
     * @param notifications
     * @param phoneNumber
     * @param profilePicturePath
     * @returns {{displayName: *, membershipType: *, links: [null], profilePicturePath: *}}
     * @private
     */
    static #getUserResponse({
        dateRegistered,
        displayName,
        emailAddress,
        firstName,
        lastName,
        membershipType,
        notifications = [],
        phoneNumber,
        profilePicturePath,
    }) {
        const subscriptions = notifications.map(notification => {
            const { enabled, type } = notification;

            return {
                enabled,
                type,
            };
        });

        return {
            dateRegistered,
            displayName,
            emailAddress,
            firstName,
            lastName,
            membershipType,
            notifications: subscriptions,
            phoneNumber,
            links: [
                {
                    rel: 'characters',
                    href: '/destiny/characters',
                },
            ],
            profilePicturePath,
        };
    }

    /**
     * Allow only replace operations of mutable fields.
     *
     * @param patches
     * @private
     */
    static #scrubOperations(patches) {
        const mutable = new Set(['firstName', 'lastName']);
        const replacements = patches.filter(patch => patch.op === 'replace');

        return replacements.filter(replacement => {
            const properties = new Set(replacement.path.split('/'));
            const intersection = new Set([...properties].filter(x => mutable.has(x)));

            return intersection.size;
        });
    }

    /**
     * Confirm registration request by creating an account if appropriate.
     *
     * @param req
     * @param res
     */
    async join(user) {
        const registeredUser = await this.users
            .getUserByEmailAddressToken(user.tokens.emailAddress);

        if (!registeredUser
            || this.constructor.#getEpoch() > (registeredUser.membership.tokens.timeStamp + ttl)
            || !_.isEqual(user.tokens.phoneNumber, registeredUser.membership.tokens.code)) {
            return undefined;
        }

        registeredUser.dateRegistered = new Date().toISOString();

        await this.users.updateUser(registeredUser);

        return user;
    }

    /**
     * Get current user.
     * @param req
     * @param res
     */
    async getCurrentUser(displayName, membershipType) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (user) {
            const { bungie: { access_token: accessToken } } = user;

            const bungieUser = await this.destiny.getCurrentUser(accessToken);

            return bungieUser ? this.constructor.#getUserResponse(bungieUser) : undefined;
        }

        return undefined;
    }

    /**
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    getUserByEmailAddress(emailAddress) {
        return this.users.getUserByEmailAddress(emailAddress);
    }

    /**
     * Check if the phone number is registered to a current user.
     * @param req
     * @param res
     */
    async getUserById(id, version) {
        let versionNumber = parseInt(version, 10);
        if (Number.isNaN(versionNumber)) {
            versionNumber = 0;
        }

        const user = await this.users.getUserById(id);

        if (user) {
            if (versionNumber) {
                const patches = user.patches.filter(patch => patch.version >= versionNumber) || [];

                if (patches.length > 0) {
                    return this.constructor.applyPatches(_.chain(patches)
                        .sortBy(patch => -1 * patch.version)
                        .value(), user);
                }

                return undefined;
            }

            return user;
        }

        return undefined;
    }

    /**
     * Check if the phone number is registered to a current user.
     * @param req
     * @param res
     */
    getUserByPhoneNumber(phoneNumber) {
        return this.users.getUserByPhoneNumber(phoneNumber);
    }

    /**
     * User initial application request.
     * @param req
     * @param res
     */
    async signUp({ displayName, membershipType, user }) {
        const bungieUser = await this.users.getUserByDisplayName(displayName, membershipType);

        // eslint-disable-next-line no-param-reassign
        user.phoneNumber = this.constructor.#cleanPhoneNumber(user.phoneNumber);
        Object.assign(user, bungieUser, {
            membership: {
                tokens: {
                    blob: tokens.getBlob(),
                    code: tokens.getCode(),
                    timeStamp: this.constructor.#getEpoch(),
                },
            },
        });

        const userPromises = [
            this.users.getUserByEmailAddress(user.emailAddress),
            this.users.getUserByPhoneNumber(user.phoneNumber),
        ];

        const users = await Promise.all(userPromises);
        const registeredUsers = users.filter(user1 => user1 && user1.dateRegistered);

        if (registeredUsers.length) {
            return undefined;
        }

        const iconUrl = await this.world.getVendorIcon(postmasterHash);
        const promises = [];

        promises.push(this.notifications.sendMessage(
            `Enter ${
                user.membership.tokens.code} to verify your phone number.`,
            user.phoneNumber,
            user.type === 'mobile' ? iconUrl : '',
        ));
        promises.push(this.postmaster.register(user, iconUrl, '/register'));

        const result = await Promise.all(promises);
        const [message, postMark] = result;

        // eslint-disable-next-line no-param-reassign
        user.membership.message = message;
        // eslint-disable-next-line no-param-reassign
        user.membership.postmark = postMark;

        await this.users.updateUser(user);

        return user;
    }

    /**
     * Sign In with Bungie and PSN/XBox Live
     * @param req
     * @param res
     */
    async signIn({ code, displayName }) {
        const bungie = await this.destiny.getAccessTokenFromCode(code);
        const { access_token: accessToken } = bungie;
        const currentUser = await this.destiny.getCurrentUser(accessToken);

        if (!currentUser || !currentUser.membershipId) {
            return undefined;
        }

        // eslint-disable-next-line no-param-reassign
        ({ displayName } = currentUser);

        const { membershipId, membershipType, profilePicturePath } = currentUser;
        const user = {
            bungie,
            displayName,
            membershipId,
            membershipType,
            profilePicturePath,
        };
        const destinyGhostUser = await this.users.getUserByMembershipId(user.membershipId);

        if (!destinyGhostUser) {
            return this.users.createAnonymousUser(user)
                .then(() => user);
        }

        Object.assign(destinyGhostUser, user);

        return (destinyGhostUser.dateRegistered
            ? this.users.updateUser(destinyGhostUser)
            : this.users.updateAnonymousUser(destinyGhostUser))
            .then(() => user);
    }

    /**
     * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
     * {@tutorial http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot}
     * @param req
     * @param res
     * @returns {*}
     */
    async update({ displayName, membershipType, patches }) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType, true);

        if (!user) {
            return undefined;
        }

        const userCopy = JSON.parse(JSON.stringify(user));

        jsonpatch.applyPatch(user, this.constructor.#scrubOperations(patches));

        const patch = jsonpatch.createPatch(user, userCopy);
        const version = user.version || 1;

        user.version = version + 1;
        if (!user.patches) {
            user.patches = [];
        }
        user.patches.push({
            patch,
            version,
        });

        await this.users.updateUser(user);

        return user;
    }
}

module.exports = UserController;
