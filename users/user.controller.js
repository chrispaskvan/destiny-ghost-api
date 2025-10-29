/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
import { applyPatch, createPatch } from 'rfc6902';
import { parsePhoneNumber } from 'awesome-phonenumber'
import Postmaster from '../helpers/postmaster.js';
import getEpoch from '../helpers/get-epoch.js';
import { getBlob, getCode } from '../helpers/tokens.js';
import { postmasterHash } from '../destiny/destiny.constants.js';

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
     * Get the phone number format into the Twilio standard: e164.
     * Deny phone numbers from China, North Korea, and Russia.
     *
     * @param phoneNumber
     * @returns {string}
     * @private
     */
    static #cleanPhoneNumber(phoneNumber) {
        const cleaned = parsePhoneNumber(phoneNumber[0] === '+' ? phoneNumber : `+1${phoneNumber}`);

        if (!cleaned.valid || ['CN', 'KP', 'RU'].includes(cleaned.regionCode)) {
            throw new Error('phone number is invalid', { cause: cleaned.error });
        }

        return cleaned?.number?.e164;
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
            links: [
                {
                    rel: 'characters',
                    href: '/destiny2/characters',
                },
            ],
            notifications: subscriptions,
            phoneNumber,
            profilePicturePath,
        };
    }

    static #applyPatches(patches, user) {
        for (const { patch } of patches) {
            applyPatch(user, patch);
        }

        return user;
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
     * Validate a user token.
     * 
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {string} param0.membershipType
     * @param {string} param0.channel
     * @param {string} param0.code
     * @returns {Promise<Object>}
     */
    async decipher({ displayName, membershipType, channel, code }) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (!user) {
            throw new Error('user not found');
        }
        if (getEpoch() > (user?.membership?.tokens?.timeStamp + ttl)) {
            throw new Error('token expired');
        }
        if ((channel === 'phone' && user?.membership?.tokens?.code !== code)
            || (channel === 'email' && user?.membership?.tokens?.blob !== code)) {
            throw new Error('invalid code');
        }

        return user;
    }

    /**
     * Delete inconsequential message documents for the given user.
     * @param {Object} user
     */
    async deleteUserMessages(user) {
        if (user?.phoneNumber) {
            return await this.users.deleteUserMessages(user.phoneNumber);
        }

        throw new Error('user is corrupted');
    }

    /**
     * @typedef {Object} CurrentUser
     * @property {string} ETag
     * @property {Object} User
     */

    /**
     * Get current user.
     * @param req
     * @param res
     * @returns {Promise<CurrentUser>}
     */
    async getCurrentUser(displayName, membershipType) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (user) {
            const { bungie: { access_token: accessToken }, _etag: ETag } = user;
            const bungieUser = await this.destiny.getCurrentUser(accessToken);

            return bungieUser
                ? {
                    ETag,
                    user: UserController.#getUserResponse(user),
                } : {};
        }

        return {};
    }

    /**
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    async getUserByEmailAddress(emailAddress) {
        return await this.users.getUserByEmailAddress(emailAddress);
    }

    /**
     * Get user by id.
     * @param req
     * @param res
     */
    async getUserById(id, version) {
        let versionNumber = parseInt(version, 10);

        if (Number.isNaN(versionNumber) || versionNumber < 0) {
            versionNumber = 0;
        }

        const user = await this.users.getUserById(id);

        if (user) {
            if (versionNumber) {
                const patches = user.patches.filter(patch => patch.version <= versionNumber) || [];

                if (patches.length > 0) {
                    const patchedUser = UserController.#applyPatches(patches
                        .sort(patch => patch.version), user);

                    delete patchedUser.patches;
                    delete patchedUser.version;

                    return { version: versionNumber, ...patchedUser };
                }
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
    async getUserByPhoneNumber(phoneNumber) {
        return await this.users.getUserByPhoneNumber(phoneNumber);
    }

    /**
     * Confirm registration request by creating an account if appropriate.
     *
     * @param req
     * @param res
     */
    async join(user) {
        const registeredUser = await this.users
            .getUserByEmailAddressToken(user?.tokens?.emailAddress);

        if (!registeredUser
            || getEpoch() > (registeredUser?.membership?.tokens?.timeStamp + ttl)
            || user?.tokens?.phoneNumber !== registeredUser?.membership?.tokens?.code) {
            return undefined;
        }

        registeredUser.dateRegistered = new Date().toISOString();

        await this.users.updateUser(registeredUser);

        return user;
    }

    /**
     * Send a verification code to the user.
     * 
     * @param {*} user
     */
    async sendCipher({ displayName, membershipType, channel }) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (!(user && user?.dateRegistered && user?.emailAddress && user?.phoneNumber)) {
            throw new Error('registration not found');
        }

        const iconUrl = await this.world.getVendorIcon(postmasterHash);

        if (channel === 'phone') {
            Object.assign(user, {
                membership: {
                    tokens: {
                        code: getCode(),
                        timeStamp: getEpoch(),
                    },
                },
            });

            user.membership.message = await this.notifications.sendMessage(
                `Enter ${user.membership.tokens.code} to verify your phone number.`,
                user.phoneNumber,
                user.type === 'mobile' ? iconUrl : '',
            );
        }

        if (channel === 'email') {
            Object.assign(user, {
                membership: {
                    tokens: {
                        blob: getBlob(),
                        timeStamp: getEpoch(),
                    },
                },
            });

            user.membership.postmark = await this.postmaster.confirm(user, iconUrl, '/confirm');
        }

        await this.users.updateUser(user);
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
            return await this.users.createAnonymousUser(user)
                .then(() => user);
        }

        Object.assign(destinyGhostUser, user);

        return (destinyGhostUser.dateRegistered
            ? this.users.updateUser(destinyGhostUser)
            : this.users.updateAnonymousUser(destinyGhostUser))
            .then(() => user);
    }

    /**
     * User initial application request.
     * @param req
     * @param res
     */
    async signUp({ displayName, membershipType, user }) {
        const bungieUser = await this.users.getUserByDisplayName(displayName, membershipType);

        user.phoneNumber = UserController.#cleanPhoneNumber(user.phoneNumber);
        Object.assign(user, bungieUser, {
            membership: {
                tokens: {
                    blob: getBlob(),
                    code: getCode(),
                    timeStamp: getEpoch(),
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
            `Enter ${user.membership.tokens.code} to verify your phone number.`,
            user.phoneNumber,
            user.type === 'mobile' ? iconUrl : '',
        ));
        promises.push(this.postmaster.register(user, iconUrl, '/register'));

        const result = await Promise.all(promises);
        const [message, postMark] = result;

        user.membership.message = message;
        user.membership.postmark = postMark;

        await this.users.updateUser(user);

        return user;
    }

    /**
     * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
     * {@tutorial http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot}
     * @param req
     * @param res
     * @returns {Promise}
     */
    async update({ ETag, displayName, membershipType, patches }) {
        const user = await this.users.getUserByDisplayName(displayName, membershipType, true);

        if (!user) {
            return undefined;
        }
        if (user._etag !== ETag) {
            throw new Error('precondition failed');
        }

        const userCopy = JSON.parse(JSON.stringify(user));

        applyPatch(user, UserController.#scrubOperations(patches));

        const patch = createPatch(user, userCopy);
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

export default UserController;
