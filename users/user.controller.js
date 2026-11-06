// @ts-check
/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
import { isDeepStrictEqual } from 'node:util';
import { applyPatch, createPatch } from 'rfc6902';
import InvalidCipherError from './invalid-cipher.error.js';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';
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
 * @property {number} [tokenTtlSeconds] - how long a verification code or email
 * link stays valid; defaults to `DEFAULT_TOKEN_TTL_SECONDS`
 * @property {import('./user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * How long a verification token stays valid when nothing is configured.
 *
 * Fifteen minutes, so an emailed link survives greylisting, which can hold a
 * message for five to fifteen. `join` checks the SMS code and the email link
 * together against one timestamp, so one TTL covers both: a shorter one for
 * either channel would decide `join` on its own (#571).
 *
 * The longer window does not make the six-digit code guessable: `join` also
 * needs the 128-bit email token, and `decipher` the user's session.
 * @type {number}
 */
const DEFAULT_TOKEN_TTL_SECONDS = 900;

/**
 * User Controller Class
 */
class UserController {
    /** @type {number} */
    #tokenTtlSeconds;

    /**
     * @param {UserControllerOptions} options
     */
    constructor(options) {
        const { tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS } = options;

        /**
         * Checked here so a bad `settings/users.json` stops the server at
         * startup, rather than expiring every code, or none, at runtime.
         */
        if (!Number.isSafeInteger(tokenTtlSeconds) || tokenTtlSeconds <= 0) {
            throw new TypeError(
                `tokenTtlSeconds must be a positive integer; got ${JSON.stringify(tokenTtlSeconds)}`,
            );
        }

        this.#tokenTtlSeconds = tokenTtlSeconds;
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
            throw new InvalidPhoneNumberError('phone number is invalid', {
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
     * @param {Pick<MutableUser, 'dateRegistered' | 'displayName' | 'emailAddress' | 'firstName' | 'lastName' | 'notifications' | 'phoneNumber' | 'profilePicturePath'>} param0
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
        /**
         * Read past the cache: `sendCipher` saves the token before sending it,
         * but a cache refresh that fails after that save is only logged, and
         * a cached read would then check the code against the previous one.
         */
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType, true)
        );

        if (!user) {
            throw new InvalidCipherError('user not found');
        }
        if (getEpoch() > (user?.membership?.tokens?.timeStamp ?? 0) + this.#tokenTtlSeconds) {
            throw new InvalidCipherError('token expired');
        }
        if (
            (channel === 'phone' && user?.membership?.tokens?.code !== code) ||
            (channel === 'email' && user?.membership?.tokens?.blob !== code)
        ) {
            throw new InvalidCipherError('invalid code');
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
        const user = await this.users.getUserByDisplayName(displayName, membershipType);

        if (user?.bungie) {
            const { access_token: accessToken } = user.bungie;
            const { _etag: ETag } = user;
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
            getEpoch() >
                (registeredUser?.membership?.tokens?.timeStamp ?? 0) + this.#tokenTtlSeconds ||
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
     * The new token is saved before it is sent, so every code that reaches
     * the user is one `decipher` can check. Sending first left a delivered
     * code unsaved whenever the write failed, and the retry sent, and
     * billed, another (#796). A failed send rejects but keeps the token: it
     * may still have been delivered, and the user can ask again.
     *
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {'phone' | 'email'} param0.channel
     * @returns {Promise<void>}
     */
    async sendCipher({ displayName, membershipType, channel }) {
        /** Read past the cache: a stale `_etag` would fail the write below. */
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType, true)
        );

        if (!(user?.dateRegistered && user?.emailAddress && user?.phoneNumber)) {
            throw new Error('registration not found');
        }

        const iconUrl = await this.world.getVendorIcon(postmasterHash);
        const tokens =
            channel === 'phone'
                ? { code: getCode(), timeStamp: getEpoch() }
                : { blob: getBlob(), timeStamp: getEpoch() };

        user.membership = { tokens };

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));

        /** @type {Membership} */
        const receipts =
            channel === 'phone'
                ? {
                      message: await this.notifications.sendMessage(
                          UserController.#buildVerificationMessage(
                              /** @type {string} */ (tokens.code),
                          ),
                          user.phoneNumber,
                          user.type === 'mobile' ? iconUrl : '',
                      ),
                  }
                : {
                      postmark: await this.postmaster.confirm(
                          /** @type {import('../helpers/postmaster.js').EmailUser} */ (
                              /** @type {unknown} */ (user)
                          ),
                          iconUrl,
                          '/confirm',
                      ),
                  };

        await this.#saveReceipts({ displayName, membershipType, tokens }, receipts);
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
        let destinyGhostUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByMembershipId(/** @type {string} */ (user.membershipId))
        );

        /**
         * Moving the membership that owns cross-saved data changes both the
         * platform membership id and the platform, so the lookup above misses
         * and the player would sign in as a stranger: a second document, in a
         * second Cosmos partition, with their registration stranded on the
         * first. The Bungie.net membership id on the token is the one
         * identifier that survives the change.
         */
        if (!destinyGhostUser) {
            destinyGhostUser = /** @type {MutableUser | undefined} */ (
                await this.users.getUserByBungieMembershipId(bungie.membership_id)
            );
        }

        if (!destinyGhostUser) {
            return await this.users
                .createAnonymousUser(/** @type {AnonymousUser} */ (user))
                .then(() => user);
        }

        /**
         * A record marked for a move whose successor was never created. The
         * player is signing in on the platform they were already on, so the
         * move is moot and the mark has to come off - while it is there, every
         * lookup but the Bungie-id one skips this record.
         */
        if (
            destinyGhostUser.movedTo !== undefined &&
            destinyGhostUser.membershipType === user.membershipType
        ) {
            await this.users.clearPlatformMove(
                /** @type {import('../helpers/documents.js').CosmosDocument<User>} */ (
                    /** @type {unknown} */ (destinyGhostUser)
                ),
            );

            delete destinyGhostUser.movedTo;
        }

        /**
         * `membershipType` is the partition key, so a changed platform is a
         * move rather than an update - `updateUser` would look the document up
         * under the new platform, find nothing, and throw.
         */
        if (destinyGhostUser.membershipType !== user.membershipType) {
            return await this.users
                .movePlatform(
                    /** @type {import('../helpers/documents.js').CosmosDocument<User>} */ (
                        /** @type {unknown} */ (destinyGhostUser)
                    ),
                    user,
                )
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
     * @param {{ firstName: string, lastName: string, phoneNumber: string, emailAddress: string }} param0.contact
     * @returns {Promise<{ undelivered: Array<'phone' | 'email'> } | undefined>} the channels
     * whose verification message could not be sent; `undefined` when this
     * account is already registered, or the address or number belongs to a
     * registered user, and nothing was sent or saved
     */
    async signUp({ displayName, membershipType, contact }) {
        const bungieUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType)
        );

        /**
         * Phone normalization stays ahead of the lookups below: its E.164
         * output is what a stored number is matched against, and it carries
         * the barred-region check.
         */
        const phoneNumber = UserController.#cleanPhoneNumber(contact.phoneNumber);

        /**
         * Sign-up is first registration only. A registered account changes
         * its contact through `PATCH /users` and the cipher checks; letting it
         * through here would replace verified contact with unverified
         * contact before anything is checked. Checked after the phone
         * number, so a number that cannot be used still answers 422: that
         * describes the caller's own input, not anyone's registration.
         */
        if (bungieUser?.dateRegistered) {
            return undefined;
        }

        /**
         * Assembled from three trusted sources rather than merged onto the
         * request body: the contact fields the route allowlisted, the stored
         * record this session already owns, and a token pair minted here. The
         * body never reaches the document, so a field the stored record
         * happens to lack - `dateRegistered`, `notifications`, `isSubscribed` -
         * cannot ride in on it.
         */
        const user = /** @type {MutableUser} */ ({
            ...bungieUser,
            emailAddress: contact.emailAddress,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phoneNumber,
            membership: {
                tokens: {
                    blob: getBlob(),
                    code: getCode(),
                    timeStamp: getEpoch(),
                },
            },
        });

        const userPromises = [
            this.users.getUserByEmailAddress(contact.emailAddress),
            this.users.getUserByPhoneNumber(phoneNumber),
        ];
        const users = await Promise.all(userPromises);
        const registeredUsers = users.filter(user1 => user1?.dateRegistered);

        if (registeredUsers.length) {
            return undefined;
        }

        const iconUrl = await this.world.getVendorIcon(postmasterHash);
        const membership = /** @type {Membership} */ (user.membership);

        /**
         * Saved before anything is sent, so every code that reaches the user
         * is one `join` can check. Sending first left a delivered code
         * unsaved whenever the other channel or this write failed (#571).
         */
        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));

        /**
         * Settled independently: one channel failing neither stops the other
         * nor undoes the save.
         */
        const [sms, email] = await Promise.allSettled([
            this.notifications.sendMessage(
                UserController.#buildVerificationMessage(
                    /** @type {string} */ (membership.tokens?.code),
                ),
                phoneNumber,
                user.type === 'mobile' ? iconUrl : '',
            ),
            this.postmaster.register(
                /** @type {import('../helpers/postmaster.js').EmailUser} */ (
                    /** @type {unknown} */ (user)
                ),
                iconUrl,
                '/register',
            ),
        ]);

        /** @type {Membership} */
        const receipts = {};
        /** @type {Array<'phone' | 'email'>} */
        const undelivered = [];

        for (const [channel, outcome, field] of /** @type {const} */ ([
            ['phone', sms, 'message'],
            ['email', email, 'postmark'],
        ])) {
            if (outcome.status === 'fulfilled') {
                receipts[field] = outcome.value;
            } else {
                undelivered.push(channel);
                log.error(
                    { err: outcome.reason, channel, displayName, membershipType },
                    'Failed to send a sign-up verification message.',
                );
            }
        }

        /**
         * When nothing went out, the codes just saved stay: the user signs up
         * again. Putting back an earlier sign-up's codes would let them
         * register the contact saved above, which those codes never reached;
         * and a send that failed may still have been delivered.
         */
        if (Object.keys(receipts).length) {
            await this.#saveReceipts(
                { displayName, membershipType, tokens: membership.tokens },
                receipts,
            );
        }

        return { undelivered };
    }

    /**
     * Add the delivery receipts of a verification already saved - a sign-up
     * or a cipher - which are kept for billing.
     *
     * Best effort, because the outcome of the sends is already settled:
     * failing the request now would only invite a retry that sends, and
     * bills, the messages again. A failure is logged with the account and the
     * provider's ids, enough to reconcile them.
     *
     * Applied to a fresh read rather than the document the caller built, so a
     * `join` that landed while the messages were sending is kept, and the read
     * brings the ETag that guards this write against anything later. A read
     * holding other tokens means a newer sign-up or cipher replaced them, and
     * these receipts are not for the messages it sent. The whole token set is
     * compared: a sign-up has both a code and a blob, a phone cipher only a
     * code, an email cipher only a blob.
     * @param {{ displayName: string, membershipType: number, tokens?: MembershipTokens }} saved -
     * the account, and the tokens as they were saved
     * @param {Membership} receipts - `message` and/or `postmark`
     * @returns {Promise<void>}
     */
    async #saveReceipts({ displayName, membershipType, tokens }, receipts) {
        const context = {
            displayName,
            membershipType,
            sid: receipts.message?.sid,
            messageId: receipts.postmark?.messageId,
        };

        try {
            const current = /** @type {MutableUser | undefined} */ (
                await this.users.getUserByDisplayName(displayName, membershipType, true)
            );

            if (!current || !isDeepStrictEqual(current.membership?.tokens, tokens)) {
                log.warn(context, 'The saved tokens have changed; not saving their receipts.');

                return;
            }

            current.membership = { ...current.membership, ...receipts };

            await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (current)));
        } catch (err) {
            log.error({ err, ...context }, 'Failed to save verification delivery receipts.');
        }
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
