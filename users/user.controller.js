// @ts-check
/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyPatch, createPatch } from 'rfc6902';
import CipherAttemptsExceededError from './cipher-attempts-exceeded.error.js';
import InvalidCipherError from './invalid-cipher.error.js';
import cleanPhoneNumber from './clean-phone-number.js';
import TOKEN_TTL_SECONDS from './token-ttl.js';
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
 * Contact submitted at sign-up and not yet verified. `join` promotes it to
 * the top level of the document once both codes check out; until then the
 * top-level contact is only ever verified contact (#794).
 * @typedef {Object} PendingContact
 * @property {string} emailAddress
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} phoneNumber - E.164
 */

/**
 * @typedef {Object} Membership
 * @property {MembershipTokens} [tokens]
 * @property {PendingContact} [pending]
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
 *   id?: string,
 *   membership?: Membership,
 *   patches?: VersionedPatch[],
 *   version?: number,
 * }} MutableUser
 */

/**
 * Constructor options for UserController.
 * @typedef {Object} UserControllerOptions
 * @property {(key: string) => Promise<boolean>} allowCipherAttempt - spends one
 * of a verification code's attempts, keyed on the token; false once they are
 * spent (see `helpers/rate-limiter.middleware.js`)
 * @property {import('../destiny/destiny.service.js').default} destinyService
 * @property {import('../notifications/notification.service.js').default} notificationService
 * @property {(phoneNumber: string) => Promise<{ isSubscribed: boolean, receivedAt: number } | undefined>} readConsent
 * - a STOP or START for the number that the stored documents may not hold yet
 * (see `helpers/consent-marker.js`)
 * @property {import('./user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * User Controller Class
 */
class UserController {
    /** @type {(key: string) => Promise<boolean>} */
    #allowCipherAttempt;

    /** @type {UserControllerOptions['readConsent']} */
    #readConsent;

    /**
     * @param {UserControllerOptions} options
     */
    constructor(options) {
        /** Required: without it, cryptarch would allow unlimited guesses. */
        if (typeof options.allowCipherAttempt !== 'function') {
            throw new TypeError('allowCipherAttempt is required');
        }

        /**
         * Required: without it, a STOP sent between sign-up and `join` would
         * be lost, since no document holds the pending number yet.
         */
        if (typeof options.readConsent !== 'function') {
            throw new TypeError('readConsent is required');
        }

        this.#allowCipherAttempt = options.allowCipherAttempt;
        this.#readConsent = options.readConsent;
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

        /**
         * Registered accounts only: a pending sign-up verifies through
         * `join`. Refused before an attempt is spent, because a sign-up that
         * hit a conflict saves no tokens, so its codes would answer 404 for
         * ever where a saved one reaches 429, and tell the caller which.
         */
        if (!user?.dateRegistered) {
            throw new InvalidCipherError('registration not found');
        }
        /**
         * A registered account with pending contact holds a re-sign-up's
         * tokens, which went to the new, unverified contact. They prove
         * nothing about the registered one.
         */
        if (user.membership?.pending) {
            throw new InvalidCipherError('a contact change is pending');
        }

        const tokens = user.membership?.tokens;
        /**
         * Checked to exist, not just compared: a phone cipher has no blob, so
         * an email check with no code compared `undefined` with `undefined`
         * and passed.
         */
        const expected = channel === 'phone' ? tokens?.code : tokens?.blob;

        if (!expected) {
            throw new InvalidCipherError('no code for this channel');
        }
        if (getEpoch() > (tokens?.timeStamp ?? 0) + TOKEN_TTL_SECONDS) {
            throw new InvalidCipherError('token expired');
        }

        /**
         * Spent before comparing, and on every attempt, the right one
         * included, so parallel guesses can't all get in ahead of the count.
         * Keyed on the whole token set, hashed so no code reaches Redis: a
         * new code starts a new count, even one minted in the same second.
         */
        const token = createHash('sha256')
            .update(JSON.stringify([tokens?.blob, tokens?.code, tokens?.timeStamp]))
            .digest('hex');

        if (!(await this.#allowCipherAttempt(`${membershipType}:${displayName}:${token}`))) {
            throw new CipherAttemptsExceededError();
        }
        if (code !== expected) {
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
     * @property {string} displayName - the session's account
     * @property {number} membershipType - the session's account
     * @property {{ emailAddress?: string, phoneNumber?: string }} [tokens] - the
     * emailed blob, and the SMS code
     */

    /**
     * Confirm a sign-up: once both codes check out, the pending contact
     * becomes the account's contact. A first sign-up registers the account;
     * a registered account's sign-up changes its contact.
     *
     * @param {JoinRequest} request
     * @returns {Promise<MutableUser | undefined>}
     */
    async join({ displayName, membershipType, tokens: submitted }) {
        if (!submitted?.emailAddress) {
            return undefined;
        }

        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByEmailAddressToken(submitted.emailAddress)
        );
        const tokens = user?.membership?.tokens;
        const pending = user?.membership?.pending;

        /**
         * The stored code is checked to exist, not just compared: an email
         * cipher saves a blob with no code, so a join with that blob and no
         * code compared `undefined` with `undefined` and passed. The sign-up
         * must be the session's own, now that a registered account can sign
         * up again.
         */
        if (
            !user ||
            !pending ||
            !tokens?.code ||
            user.displayName !== displayName ||
            user.membershipType !== membershipType ||
            getEpoch() > (tokens.timeStamp ?? 0) + TOKEN_TTL_SECONDS ||
            submitted.phoneNumber !== tokens.code
        ) {
            return undefined;
        }

        /**
         * Checked again at promotion: another account may have registered the
         * same email or phone since this sign-up was saved, and `signUp`'s
         * check is long past.
         */
        const holders = await Promise.all([
            this.users.getUserByEmailAddress(pending.emailAddress),
            this.users.getUserByPhoneNumber(pending.phoneNumber),
        ]);

        if (holders.some(holder => UserController.#registeredToAnother(holder, user))) {
            log.warn(
                { displayName, membershipType },
                'Not joining: the pending contact was registered by another account.',
            );

            return undefined;
        }

        const isNewRegistration = !user.dateRegistered;

        /**
         * Consent belongs to the number. A new number starts subscribed - it
         * was just signed up with - unless it texted STOP before `join`, which
         * only the consent marker holds, as no document had the number then.
         * An unchanged number keeps what it has.
         */
        const isNewNumber = isNewRegistration || user.phoneNumber !== pending.phoneNumber;

        if (isNewNumber) {
            const found = await this.#readConsent(pending.phoneNumber);

            user.isSubscribed = found ? found.isSubscribed : true;
        }

        Object.assign(user, pending);
        /** Tokens and pending contact are spent; receipts stay, for billing. */
        user.membership = {
            message: user.membership?.message,
            postmark: user.membership?.postmark,
        };

        if (isNewRegistration) {
            user.dateRegistered = Temporal.Now.instant().toString({
                smallestUnit: 'millisecond',
            });
        }

        if (!user.notifications?.length) {
            user.notifications = Object.values(notificationTypes).map(type => ({
                enabled: false,
                type,
                messages: [],
            }));
        }

        await this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)));

        /**
         * Read again now the document holds the number. A STOP handled
         * between the read above and the promotion found no document to
         * write to, so only the marker has it. From here on, any change is
         * written to the document directly, so nothing is lost after this.
         * The marker keeps the newest change it was given.
         */
        if (isNewNumber) {
            const latest = await this.#readConsent(pending.phoneNumber);

            if (latest) {
                user.isSubscribed = latest.isSubscribed;
                await this.#stampConsent(
                    { displayName, membershipType },
                    pending.phoneNumber,
                    latest,
                );
            }
        }

        /** Not to a number that texted STOP before joining. */
        if (isNewRegistration && user.isSubscribed !== false) {
            try {
                await this.notifications.sendMessage(
                    UserController.#buildWelcomeMessage(),
                    pending.phoneNumber,
                    '',
                );
            } catch (err) {
                log.error({ err }, 'Failed to send welcome message.');
            }
        }

        return user;
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

        const iconUrl = await this.#vendorIcon();
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
                          user.type === 'mobile' ? (iconUrl ?? '') : '',
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
     * Sign up, or, for a registered account, change contact: the submitted
     * contact is saved as pending and sent its codes, and `join` makes it the
     * account's contact once both check out.
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {{ firstName: string, lastName: string, phoneNumber: string, emailAddress: string }} param0.contact
     * @returns {Promise<{ undelivered: Array<'phone' | 'email'> } | undefined>} the channels
     * whose verification message could not be sent; `undefined` when the
     * address or number belongs to another registered account, and nothing
     * was sent or saved
     */
    async signUp({ displayName, membershipType, contact }) {
        const bungieUser = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType, true)
        );

        /**
         * Phone normalization stays ahead of the lookups below: its E.164
         * output is what a stored number is matched against, and it carries
         * the barred-region check.
         */
        const phoneNumber = cleanPhoneNumber(contact.phoneNumber);

        /**
         * Assembled from three trusted sources rather than merged onto the
         * request body: the contact fields the route allowlisted, the stored
         * record this session already owns, and a token pair minted here. The
         * body never reaches the document, so a field the stored record
         * happens to lack - `dateRegistered`, `notifications`, `isSubscribed` -
         * cannot ride in on it.
         *
         * The contact goes under `membership.pending`, not the top level, so
         * the top level - what every contact lookup reads - only ever holds
         * verified contact, and a registered account's stays in place until
         * `join` (#794).
         */
        /** @type {PendingContact} */
        const pending = {
            emailAddress: contact.emailAddress,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phoneNumber,
        };
        const user = /** @type {MutableUser} */ ({
            ...bungieUser,
            membership: {
                tokens: {
                    blob: getBlob(),
                    code: getCode(),
                    timeStamp: getEpoch(),
                },
                pending,
            },
        });

        /**
         * A conflict is contact registered to another account. The account's
         * own current contact isn't one: re-signing up with the same email to
         * change only the phone is fine.
         */
        const holders = await Promise.all([
            this.users.getUserByEmailAddress(contact.emailAddress),
            this.users.getUserByPhoneNumber(phoneNumber),
        ]);

        if (holders.some(holder => UserController.#registeredToAnother(holder, bungieUser))) {
            return undefined;
        }

        const iconUrl = await this.#vendorIcon();
        const membership = /** @type {Membership} */ (user.membership);

        /**
         * Saved before anything is sent, so every code that reaches the user
         * is one `join` can check. Sending first left a delivered code
         * unsaved whenever the other channel or this write failed (#571).
         */
        await this.#save(user);

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
                user.type === 'mobile' ? (iconUrl ?? '') : '',
            ),
            this.postmaster.register(
                /** @type {import('../helpers/postmaster.js').EmailUser} */ (
                    /** @type {unknown} */ ({ ...user, ...pending })
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
     * Send a pending sign-up's verification message again, on one channel.
     *
     * The same code or link goes out, and the saved tokens are left alone, so
     * a message that did arrive, perhaps late, still works, and the other
     * channel is untouched. A fresh pair means signing up again.
     *
     * Resolves whatever happens: nothing to resend, or a send that failed,
     * is only logged. The route answers the same either way, because whether
     * a sign-up was saved is what the conflict check decides, so telling the
     * caller would reveal whether its address or number is registered.
     * @param {Object} param0
     * @param {string} param0.displayName
     * @param {number} param0.membershipType
     * @param {'phone' | 'email'} param0.channel
     * @returns {Promise<void>}
     */
    async resend({ displayName, membershipType, channel }) {
        const context = { displayName, membershipType, channel };
        const user = /** @type {MutableUser | undefined} */ (
            await this.users.getUserByDisplayName(displayName, membershipType, true)
        );
        const tokens = user?.membership?.tokens;
        const pending = user?.membership?.pending;

        /**
         * A pending sign-up holds both tokens and the pending contact, for a
         * new account or a registered one changing its contact. A cipher
         * holds one token and no pending contact, and isn't this endpoint's
         * to resend.
         */
        if (
            !user ||
            !pending ||
            !tokens?.blob ||
            !tokens?.code ||
            getEpoch() > (tokens.timeStamp ?? 0) + TOKEN_TTL_SECONDS
        ) {
            log.info(context, 'No pending sign-up to resend.');

            return;
        }

        const iconUrl = await this.#vendorIcon();
        /** @type {Membership} */
        let receipts;

        try {
            receipts =
                channel === 'phone'
                    ? {
                          message: await this.notifications.sendMessage(
                              UserController.#buildVerificationMessage(tokens.code),
                              pending.phoneNumber,
                              user.type === 'mobile' ? (iconUrl ?? '') : '',
                          ),
                      }
                    : {
                          postmark: await this.postmaster.register(
                              /** @type {import('../helpers/postmaster.js').EmailUser} */ (
                                  /** @type {unknown} */ ({ ...user, ...pending })
                              ),
                              iconUrl,
                              '/register',
                          ),
                      };
        } catch (err) {
            log.error({ err, ...context }, 'Failed to resend a sign-up verification message.');

            return;
        }

        await this.#saveReceipts({ displayName, membershipType, tokens }, receipts);
    }

    /**
     * Record the new number's consent with its own timestamp, through the one
     * write that sets the watermark (`updateUser` clears it when the number
     * changes). Without it, a delayed consent change for the number, older
     * than this one, would still win.
     *
     * Once the promotion lands, the document holds the number, so a STOP or
     * START sent right then is written to it directly. A stamp older than
     * what is stored is superseded and skipped, by `applyConsent`'s rule:
     * strictly older loses. One landing after the read fails the write's
     * ETag instead.
     *
     * Best effort, and logged on failure. Usually the promotion already
     * wrote `isSubscribed`, so a failure only leaves the watermark behind; a
     * STOP handled during the promotion is then left in the marker alone,
     * which still suppresses sends until it expires.
     *
     * Only onto the number it describes: skipped if the account no longer
     * holds it.
     * @param {{ displayName: string, membershipType: number }} account
     * @param {string} phoneNumber - the number the consent belongs to
     * @param {{ isSubscribed: boolean, receivedAt: number }} consent
     * @returns {Promise<void>}
     */
    async #stampConsent(
        { displayName, membershipType },
        phoneNumber,
        { isSubscribed, receivedAt },
    ) {
        try {
            const promoted = await this.users.getUserByDisplayName(
                displayName,
                membershipType,
                true,
            );

            if (promoted?.phoneNumber !== phoneNumber) {
                return;
            }

            if (
                typeof promoted.consentUpdatedAt === 'number' &&
                promoted.consentUpdatedAt > receivedAt
            ) {
                return;
            }

            await this.users.updateUserSubscription(promoted, isSubscribed, receivedAt);
        } catch (err) {
            log.error(
                { err, displayName, membershipType },
                "Failed to stamp the new number's consent.",
            );
        }
    }

    /**
     * Whether contact found by a lookup is registered to an account other
     * than `account`. The account itself counts only when its id is known:
     * comparing two missing ids would call any registered holder "self".
     * @param {{ id?: string, dateRegistered?: string } | undefined} holder - the
     * document a lookup found
     * @param {{ id?: string } | undefined} account - the account signing up
     * @returns {boolean}
     */
    static #registeredToAnother(holder, account) {
        return Boolean(holder?.dateRegistered) && (!account?.id || holder?.id !== account.id);
    }

    /**
     * Write a document by the schema it satisfies. A registered document
     * holds verified contact at the top level, which `updateUser`'s schema
     * requires; an unregistered one holds its contact under
     * `membership.pending` and has none there.
     * @param {MutableUser} user
     * @returns {Promise<void>}
     */
    #save(user) {
        return user.dateRegistered
            ? this.users.updateUser(/** @type {User} */ (/** @type {unknown} */ (user)))
            : this.users.updateAnonymousUser(/** @type {AnonymousUser} */ (user));
    }

    /**
     * The icon that decorates a verification message. Optional: a message
     * without it still verifies.
     *
     * Never throws. The manifest behind it can be unavailable (a 503), and
     * sign-up and resend look it up only on the path that sends, so letting
     * it fail the request would answer differently exactly when there was a
     * sign-up to send for.
     * @returns {Promise<string | undefined>}
     */
    async #vendorIcon() {
        try {
            return await this.world.getVendorIcon(postmasterHash);
        } catch (err) {
            log.warn({ err }, 'No vendor icon for the verification message.');

            return undefined;
        }
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

            await this.#save(current);
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
