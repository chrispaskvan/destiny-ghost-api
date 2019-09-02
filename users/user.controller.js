/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
const _ = require('underscore');
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
     * Apply JSON patches successively in reverse order.
     *
     * @param patches {Array}
     * @param user {Object}
     * @private
     */
    static applyPatches(patches, user) {
        patches.forEach(patch => {
            jsonpatch.applyPatch(user, patch.patch);
        });

        return user;
    }

    /**
     * Get the phone number format into the Twilio standard.
     *
     * @param phoneNumber
     * @returns {string}
     * @private
     */
    static cleanPhoneNumber(phoneNumber) {
        const cleaned = phoneNumber.replace(/\D/g, '');

        return `+1${cleaned}`;
    }

    /**
     * Get current epoch.
     *
     * @returns {number}
     * @private
     */
    static getEpoch() {
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
    static getUserResponse({
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
    static scrubOperations(patches) {
        const mutable = new Set(['firstName', 'lastName']);
        const replacements = patches.filter(patch => patch.op === 'replace');

        return replacements.filter(replacement => {
            const properties = new Set(replacement.path.split('/'));
            const intersection = new Set([...properties].filter(x => mutable.has(x)));

            return intersection.size;
        });
    }

    /**
     * Sign the user in by setting the session.
     *
     * @param req
     * @param res
     * @param user
     * @private
     */
    static signIn(req, res, user) {
        req.session.displayName = user.displayName;
        req.session.membershipType = user.membershipType;
        req.session.state = undefined;

        return res.status(200)
            .json({ displayName: user.displayName });
    }

    /**
     * Confirm registration request by creating an account if appropriate.
     *
     * @param req
     * @param res
     */
    async join(req, res) {
        const { body: user } = req;
        const registeredUser = await this.users.getUserByEmailAddressToken(user.tokens.emailAddress); // eslint-disable-line max-len

        if (!registeredUser
            || this.constructor.getEpoch() > (registeredUser.membership.tokens.timeStamp + ttl)
            || !_.isEqual(user.tokens.phoneNumber, registeredUser.membership.tokens.code)) {
            return res.status(498).end();
        }

        registeredUser.dateRegistered = new Date().toISOString();

        await this.users.updateUser(registeredUser);

        return res.status(200).end();
    }

    /**
     * Get current user.
     * @param req
     * @param res
     */
    async getCurrentUser(req, res) {
        const { session: { displayName, membershipType } } = req;

        if (!displayName || !membershipType) {
            return res.status(401).end();
        }

        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (user) {
            const { bungie: { access_token: accessToken } } = user;

            const bungieUser = await this.destiny.getCurrentUser(accessToken);
            if (bungieUser) {
                return res.status(200)
                    .json(this.constructor.getUserResponse(user));
            }

            return res.status(401).end();
        }

        return res.status(401).end();
    }

    /**
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    async getUserByEmailAddress(req, res) {
        const { params: { emailAddress } } = req;

        if (!emailAddress) {
            return res.status(409).send('email address not found');
        }

        const user = await this.users.getUserByEmailAddress(emailAddress);

        if (user) {
            return res.status(204).end();
        }

        return res.status(404).end();
    }

    /**
     * Check if the phone number is registered to a current user.
     * @param req
     * @param res
     */
    async getUserById(req, res) {
        const { params: { id, version: _version } } = req;

        if (!id) {
            return res.status(409).send('phone number not found');
        }

        let version = parseInt(_version, 10);
        if (Number.isNaN(version)) {
            version = 0;
        }

        const user = await this.users.getUserById(id);

        if (user) {
            if (version) {
                const patches = _.filter(user.patches, patch => patch.version >= version) || [];

                if (patches.length > 0) {
                    return res.status(200).json(this.constructor.applyPatches(_.chain(patches)
                        .sortBy(patch => -1 * patch.version)
                        .value(), user));
                }

                return res.status(404).end();
            }

            return res.status(200).json(user);
        }

        return res.status(404).end();
    }

    /**
     * Check if the phone number is registered to a current user.
     * @param req
     * @param res
     */
    async getUserByPhoneNumber(req, res) {
        const { params: { phoneNumber } } = req;

        if (!phoneNumber) {
            return res.status(409).send('phone number not found');
        }

        const user = await this.users.getUserByPhoneNumber(phoneNumber);

        if (user) {
            return res.status(204).end();
        }

        return res.status(404).end();
    }

    /**
     * User initial application request.
     * @param req
     * @param res
     */
    async signUp(req, res) {
        const { body: user, session: { displayName, membershipType } } = req;

        if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
            return res.status(422).end();
        }

        const bungieUser = await this.users.getUserByDisplayName(displayName, membershipType);

        user.phoneNumber = this.constructor.cleanPhoneNumber(user.phoneNumber);
        Object.assign(user, bungieUser, {
            membership: {
                tokens: {
                    blob: tokens.getBlob(),
                    code: tokens.getCode(),
                    timeStamp: this.constructor.getEpoch(),
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
            return res.status(409).end();
        }

        return this.world.getVendorIcon(postmasterHash)
            .then(iconUrl => {
                const promises = [];

                promises.push(this.notifications.sendMessage(`Enter ${
                    user.membership.tokens.code} to verify your phone number.`,
                user.phoneNumber, user.type === 'mobile' ? iconUrl : ''));
                promises.push(this.postmaster.register(user, iconUrl, '/register'));

                return Promise.all(promises);
            })
            .then(result => {
                const [message, postMark] = result;

                user.membership.message = message;
                user.membership.postmark = postMark;

                return this.users.updateUser(user);
            })
            .then(() => res.status(200).end());
    }

    /**
     * Sign In with Bungie and PSN/XBox Live
     * @param req
     * @param res
     */
    async signIn(req, res) {
        let {
            query: { code, state: queryState }, // eslint-disable-line prefer-const
            session: { displayName, state: sessionState }, // eslint-disable-line prefer-const
        } = req;

        if (displayName) {
            return res.status(200)
                .json({ displayName });
        }
        if (sessionState !== queryState) {
            return res.sendStatus(403);
        }

        const bungie = await this.destiny.getAccessTokenFromCode(code);
        const { access_token: accessToken } = bungie;
        const currentUser = await this.destiny.getCurrentUser(accessToken);

        if (!currentUser) {
            return res.status(451).end(); // ToDo: Document
        }
        if (!currentUser.membershipId) {
            return res.status(404).end();
        }

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
                .then(() => this.constructor.signIn(req, res, user));
        }

        Object.assign(destinyGhostUser, user);

        return (destinyGhostUser.dateRegistered
            ? this.users.updateUser(destinyGhostUser)
            : this.users.updateAnonymousUser(destinyGhostUser))
            .then(() => this.constructor.signIn(req, res, user));
    }

    /**
     * Sign In with Bungie and PSN/XBox Live
     * @param req
     * @param res
     */
    async signOut(req, res) {
        req.session.destroy();
        res.status(401).end();
    }

    /**
     * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
     * {@tutorial http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot}
     * @param req
     * @param res
     * @returns {*}
     */
    async update(req, res) {
        const { body: patches, session: { displayName, membershipType } } = req;
        const user = await this.users.getUserByDisplayName(displayName, membershipType, true);

        if (!user) {
            return res.status(404).send('user not found');
        }

        const userCopy = JSON.parse(JSON.stringify(user));

        jsonpatch.applyPatch(user, this.constructor.scrubOperations(patches));

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

        return res.json(user);
    }
}

module.exports = UserController;
