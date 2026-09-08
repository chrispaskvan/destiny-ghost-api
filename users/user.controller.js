// @ts-check
/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
import { applyPatch, createPatch } from 'rfc6902';
import { parsePhoneNumber } from 'awesome-phonenumber';
import Postmaster from '../helpers/postmaster.js';
import getEpoch from '../helpers/get-epoch.js';
import log from '../helpers/log.js';
import { getBlob, getCode } from '../helpers/tokens.js';
import { postmasterHash } from '../destiny/destiny.constants.js';
import notificationTypes from '../notifications/notification.types.js';

/** @typedef {import('./user.service.js').User} User */
/** @typedef {import('./user.service.js').AnonymousUser} AnonymousUser */
/** @typedef {import('../helpers/documents.js').CosmosDocument<User>} UserDocument */
/** @typedef {import('rfc6902').Operation} PatchOperation */

/**
 * A version-stamped patch entry appended to a user document's edit history.
 * @typedef {Object} VersionedPatch
 * @property {PatchOperation[]} patch
 * @property {number} version
 */

/**
 * In-flight verification-code state, set only during sendCipher/decipher and
 * not part of the persisted schema.
 * @typedef {Object} MembershipTokens
 * @property {string} [code]
 * @property {string} [blob]
 * @property {number} [timeStamp]
 */

/**
 * @typedef {Object} Membership
 * @property {MembershipTokens} [tokens]
 * @property {*} [message]
 * @property {*} [postmark]
 */

/**
 * The user document as this controller manipulates it in practice: the
 * persisted registered-user fields, optional anonymous-user fields (a user
 * starts anonymous and is merged with registration data over time), plus
 * fields set only in memory during specific flows.
 * @typedef {Omit<Partial<User>, 'patches'> & Partial<AnonymousUser> & {
 *   _etag?: string,
 *   membership?: Membership,
 *   patches?: VersionedPatch[],
 *   version?: number,
 * }} MutableUser
 */

/**
 * Constructor options for UserController.
 * @typedef {Object} UserControllerOptions
 * @property {import('../destiny/destiny.service.js').default} destinyService
 * @property {import('../notifications/notification.service.js').default} notificationService
 * @property {import('./user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * Time To Live for Tokens
 * @type {number}
 */
const ttl = 300;

/**
 * User Controller Class
 */
class UserController {
    /**
     * @param {UserControllerOptions} options
     */
    constructor(options) {
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.postmaster = new Postmaster();
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Build the SMS text sent to verify a phone number. Carries the A2P 10DLC
     * disclosures required on a subscriber's first message: frequency, rates,
     * and opt-out instructions. The brand prefix is added centrally when the
     * message is sent (see notification.service.js).
     *
     * @param {string} code
     * @returns {string}
     */
    static #buildVerificationMessage(code) {
        return `Enter ${code} to verify your phone number. Up to 10 msgs/week. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`;
    }

    /**
     * Build the SMS text sent after successful registration.
     *
     * @returns {string}
     */
    static #buildWelcomeMessage() {
        return 'Welcome! Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.';
    }

    /**
     * Get the phone number format into the Twilio standard: e164.
     * Deny phone numbers from China, North Korea, and Russia.
     *
     * @param {string} phoneNumber
     * @returns {string}
     */
    static #cleanPhoneNumber(phoneNumber) {
        const cleaned = parsePhoneNumber(phoneNumber[0] === '+' ? phoneNumber : `+1${phoneNumber}`);

        if (!cleaned.valid || ['CN', 'KP', 'RU'].includes(cleaned.regionCode)) {
            throw new Error('phone number is invalid', {
                cause: 'error' in cleaned ? cleaned.error : undefined,
            });
        }

        return cleaned.number.e164;
    }

    /**
     * @typedef {Object} UserResponse
     * @property {string} [dateRegistered]
     * @property {string} [displayName]
     * @property {string} [emailAddress]
     * @property {string} [firstName]
     * @property {string} [lastName]
     * @property {{ rel: string, href: string }[]} links
     * @property {{ enabled: boolean, type: string }[]} notifications
     * @property {string} [phoneNumber]
     * @property {string} [profilePicturePath]
     */

    /**
     * Hypermedia as the Engine of Application State (HATEOAS)
     *
     * @param {MutableUser} user
     * @returns {UserResponse}
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

    /**
     * @param {VersionedPatch[]} patches
     * @param {MutableUser} user
     * @returns {MutableUser}
     */
    static #applyPatches(patches, user) {
        for (const { patch } of patches) {
            applyPatch(user, patch);
        }

        return user;
    }

    /**
     * Allow only replace operations of mutable fields.
     *
     * @param {PatchOperation[]} patches
     * @returns {PatchOperation[]}
     */
    static #scrubOperations(patches) {
        /** @type {Map<string, (value: unknown) => boolean>} */
        const mutableValidators = new Map([
            ['/firstName', value => typeof value === 'string'],
            ['/lastName', value => typeof value === 'string'],
        ]);
        const notificationEnabledPattern = /^\/notifications\/\d+\/enabled$/;

        return patches.filter(patch => {
            if (patch.op !== 'replace') {
                return false;
            }
            if (mutableValidators.has(patch.path)) {
                return /** @type {(value: unknown) => boolean} */ (
                    mutableValidators.get(patch.path)
                )(patch.value);
            }
            if (notificationEnabledPattern.test(patch.path)) {
                return typeof patch.value === 'boolean';
            }

            return false;
        });
    }

    /**
     * Validate a user token.
     *
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {string} param0.channel
     * @param {string} param0.code
     * @returns {Promise<MutableUser>}
     */
    async decipher({ displayName, membershipType, channel, code }) {
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType)
        );

        if (!user) {
            throw new Error('user not found');
        }
        if (getEpoch() > (user?.membership?.tokens?.timeStamp ?? 0) + ttl) {
            throw new Error('token expired');
        }
        if (
            (channel === 'phone' && user?.membership?.tokens?.code !== code) ||
            (channel === 'email' && user?.membership?.tokens?.blob !== code)
        ) {
            throw new Error('invalid code');
        }

        return user;
    }

    /**
     * Delete inconsequential message documents for the given user.
     * @param {MutableUser} user
     * @returns {Promise<void>}
     */
    async deleteUserMessages(user) {
        if (user?.phoneNumber) {
            return await this.users.deleteUserMessages(user.phoneNumber);
        }

        throw new Error('user is corrupted');
    }

    /**
     * ETag and user are always set together, never one without the other.
     * @typedef {{ ETag: string, user: UserResponse } | { ETag?: undefined, user?: undefined }} CurrentUserResult
     */

    /**
     * Get current user.
     * @param {string} displayName
     * @param {number} membershipType
     * @returns {Promise<CurrentUserResult>}
     */
    async getCurrentUser(displayName, membershipType) {
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType)
        );

        if (user?.bungie) {
            const { access_token: accessToken } = user.bungie;
            const ETag = /** @type {string} */ (user._etag);
            const bungieUser = await this.destiny.getCurrentUser(accessToken);

            return bungieUser
                ? {
                      ETag,
                      user: UserController.#getUserResponse(user),
                  }
                : {};
        }

        return {};
    }

    /**
     * Check if the email address is registered to a current user.
     * @param {string} emailAddress
     * @returns {Promise<UserDocument | undefined>}
     */
    async getUserByEmailAddress(emailAddress) {
        return await this.users.getUserByEmailAddress(emailAddress);
    }

    /**
     * Get user by id.
     * @param {string} id
     * @param {string} version
     * @returns {Promise<MutableUser | undefined>}
     */
    async getUserById(id, version) {
        let versionNumber = parseInt(version, 10);

        if (Number.isNaN(versionNumber) || versionNumber < 0) {
            versionNumber = 0;
        }

        const user = /** @type {MutableUser | undefined} */ (await this.users.getUserById(id));

        if (user) {
            if (versionNumber) {
                const patches = user.patches?.filter(patch => patch.version <= versionNumber) || [];

                if (patches.length > 0) {
                    const patchedUser = UserController.#applyPatches(
                        patches.sort((a, b) => a.version - b.version),
                        user,
                    );

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
     * @param {string} phoneNumber
     * @returns {Promise<UserDocument | undefined>}
     */
    async getUserByPhoneNumber(phoneNumber) {
        return await this.users.getUserByPhoneNumber(phoneNumber);
    }

    /**
     * @typedef {Object} JoinRequest
     * @property {{ emailAddress?: string, phoneNumber?: string }} [tokens]
     */

    /**
     * Confirm registration request by creating an account if appropriate.
     *
     * @param {JoinRequest} user
     * @returns {Promise<MutableUser | undefined>}
     */
    async join(user) {
        if (!user?.tokens?.emailAddress) {
            return undefined;
        }

        const registeredUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByEmailAddressToken(user.tokens.emailAddress)
        );

        if (
            !registeredUser ||
            getEpoch() > (registeredUser?.membership?.tokens?.timeStamp ?? 0) + ttl ||
            user?.tokens?.phoneNumber !== registeredUser?.membership?.tokens?.code
        ) {
            return undefined;
        }

        const isNewRegistration = !registeredUser.dateRegistered;

        if (isNewRegistration) {
            registeredUser.dateRegistered = Temporal.Now.instant().toString({
                smallestUnit: 'millisecond',
            });
        }

        if (!registeredUser.notifications?.length) {
            registeredUser.notifications = Object.values(notificationTypes).map(type => ({
                enabled: false,
                type,
                messages: [],
            }));
        }

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (registeredUser)));

        if (isNewRegistration && registeredUser.phoneNumber) {
            try {
                await this.notifications.sendMessage(
                    UserController.#buildWelcomeMessage(),
                    registeredUser.phoneNumber,
                    '',
                );
            } catch (err) {
                log.error({ err }, 'Failed to send welcome message.');
            }
        }

        return registeredUser;
    }

    /**
     * Send a verification code to the user.
     *
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {string} param0.channel
     * @returns {Promise<void>}
     */
    async sendCipher({ displayName, membershipType, channel }) {
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType)
        );

        if (!(user?.dateRegistered && user?.emailAddress && user?.phoneNumber)) {
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

            const membership = /** @type {Membership} */ (user.membership);

            membership.message = await this.notifications.sendMessage(
                UserController.#buildVerificationMessage(
                    /** @type {string} */ (membership.tokens?.code),
                ),
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

            const membership = /** @type {Membership} */ (user.membership);

            membership.postmark = await this.postmaster.confirm(user, iconUrl, '/confirm');
        }

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));
    }
    /**
     * Sign In with Bungie and PSN/XBox Live. The incoming displayName is
     * never read — it's immediately overwritten below from the Bungie
     * response — so it's typed loosely to match the OAuth-callback caller,
     * which doesn't have one yet.
     * @param {Object} param0
     * @param {string} param0.code
     * @param {string} [param0.displayName]
     * @returns {Promise<MutableUser | undefined>}
     */
    async signIn({ code, displayName }) {
        const bungie = await this.destiny.getAccessTokenFromCode(code);
        const { access_token: accessToken } = bungie;
        const currentUser = await this.destiny.getCurrentUser(accessToken);

        if (!currentUser?.membershipId) {
            return undefined;
        }

        ({ displayName } = currentUser);

        const { membershipId, membershipType, profilePicturePath } = currentUser;
        /** @type {MutableUser} */
        const user = {
            bungie,
            displayName,
            membershipId,
            membershipType,
            profilePicturePath,
        };
        const destinyGhostUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByMembershipId(/** @type {string} */ (user.membershipId))
        );

        if (!destinyGhostUser) {
            return await this.users
                .createAnonymousUser(/** @type {AnonymousUser} */ (user))
                .then(() => user);
        }

        Object.assign(destinyGhostUser, user);

        return (
            destinyGhostUser.dateRegistered
                ? this.users.updateUser(
                      /** @type {User} */ (/** @type {unknown} */ (destinyGhostUser)),
                  )
                : this.users.updateAnonymousUser(/** @type {AnonymousUser} */ (destinyGhostUser))
        ).then(() => user);
    }

    /**
     * User initial application request.
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {MutableUser} param0.user
     * @returns {Promise<MutableUser | undefined>}
     */
    async signUp({ displayName, membershipType, user }) {
        const bungieUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType)
        );

        user.phoneNumber = UserController.#cleanPhoneNumber(
            /** @type {string} */ (user.phoneNumber),
        );
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
            this.users.getUserByEmailAddress(/** @type {string} */ (user.emailAddress)),
            this.users.getUserByPhoneNumber(user.phoneNumber),
        ];
        const users = await Promise.all(userPromises);
        const registeredUsers = users.filter(user1 => user1?.dateRegistered);

        if (registeredUsers.length) {
            return undefined;
        }

        const iconUrl = await this.world.getVendorIcon(postmasterHash);
        const membership = /** @type {Membership} */ (user.membership);
        const promises = [
            this.notifications.sendMessage(
                UserController.#buildVerificationMessage(
                    /** @type {string} */ (membership.tokens?.code),
                ),
                user.phoneNumber,
                user.type === 'mobile' ? iconUrl : '',
            ),
            this.postmaster.register(user, iconUrl, '/register'),
        ];

        const [message, postMark] = await Promise.all(promises);

        membership.message = message;
        membership.postmark = postMark;

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));

        return user;
    }

    /**
     * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
     * {@tutorial http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot}
     * @param {Object} param0
     * @param {string} param0.ETag
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {PatchOperation[]} param0.patches
     * @returns {Promise<MutableUser | undefined>}
     */
    async update({ ETag, displayName, membershipType, patches }) {
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType, true)
        );

        if (!user) {
            return undefined;
        }
        if (user._etag !== ETag) {
            throw new Error('precondition failed');
        }

        const userCopy = structuredClone(user);

        const results = applyPatch(user, UserController.#scrubOperations(patches));

        if (results.some(result => result !== null)) {
            throw new Error('invalid patch');
        }

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

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));

        return user;
    }
}

export default UserController;
