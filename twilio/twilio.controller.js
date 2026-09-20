// @ts-check
/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 */
import ClaimCheck from '../helpers/claim-check.js';
import getShortUrl from '../helpers/bitly.js';
import log from '../helpers/log.js';
import DestinyError from '../destiny/destiny.error.js';
import { extractEmoji, normalizeEmoji, stripEmoji } from '../helpers/emoji.js';
import { withRetry, isTransientError } from '../helpers/retry.js';
import subscriber from '../helpers/subscriber.js';
import { enqueueConsentChange, QUEUE_NAME as CONSENT_QUEUE } from './consent.queue.js';
import {
    EMOJI_DEFAULT_REPLY,
    EMOJI_INTENT_REPLIES,
    HELP_KEYWORDS,
    HELP_REPLY,
    MAX_SMS_MESSAGE_LENGTH,
    MEDIA_RECEIVED_REPLY,
    MEDIA_UNSUPPORTED_REPLY,
    START_KEYWORDS,
    START_REPLY,
    STOP_KEYWORDS,
    STOP_REPLY,
} from './twilio.constants.js';

/** @typedef {import('../authentication/authentication.service.js').UserDocument} UserDocument */
/** @typedef {import('../helpers/world2.js').ItemDefinition} ItemDefinition */

/**
 * A consent write is retried more patiently than an ordinary request. The
 * sender has already been told the change applied, so the alternative to
 * retrying is leaving them subscribed against their wishes - and unlike a
 * failed lookup, nobody is waiting on the answer.
 */
const CONSENT_WRITE_RETRIES = 5;
const CONSENT_WRITE_BASE_DELAY_MS = 500;

/**
 * Cosmos rejects a write whose `IfMatch` etag has been superseded with a 412.
 * Retrying only helps because `#persistConsent` re-reads with the cache
 * bypassed: each attempt fetches the current document and its current etag,
 * rather than replaying the stale one a cache hit would return.
 */
const PRECONDITION_FAILED = 412;

/**
 * Whether a failed consent write is worth another attempt.
 *
 * `isTransientError` reads `status`, which is what the HTTP and AI SDKs set.
 * Cosmos reports throttling, outages and precondition failures on
 * `code`/`statusCode` instead - and those are exactly the cases this retry
 * exists for - so the numeric forms are checked here rather than widening what
 * every other caller of the shared helper treats as transient. A permanent
 * fault (a schema rejection, a missing record) still fails on the first
 * attempt, because repeating it cannot help.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableConsentError(err) {
    const { code, statusCode, retryAfterInMs } =
        /** @type {{ code?: unknown, statusCode?: unknown, retryAfterInMs?: unknown }} */ (
            /** @type {unknown} */ (err)
        );

    if (typeof retryAfterInMs === 'number') {
        return true;
    }

    const status = [statusCode, code].find(value => typeof value === 'number');

    if (typeof status === 'number') {
        return status === PRECONDITION_FAILED || status === 408 || status === 429 || status >= 500;
    }

    return isTransientError(err);
}

/**
 * The reply this controller returns for one inbound SMS/MMS webhook. Route
 * handlers turn this into TwiML.
 * @typedef {Object} TwilioReply
 * @property {Record<string, string | undefined>} [cookies]
 * @property {string} [message]
 * @property {string} [media]
 */

/**
 * @typedef {(itemHash: string | undefined, cookies: Record<string, string | undefined>) => Promise<TwilioReply>} ItemKeywordHandler
 */

/**
 * A single item, ready for display in reply text: either the detail shape
 * #getItem() builds for a unique match, or the manifest item as returned by
 * World2#getItemByName() (already carrying itemCategory/itemName) when
 * multiple distinct items are shown ungrouped.
 * @typedef {Object} ItemResult
 * @property {string} [itemCategory]
 * @property {string} [icon]
 * @property {number} [itemHash]
 * @property {string} [itemName]
 * @property {number} [itemType]
 */

/**
 * The Twilio webhook body this controller reads, across both the inbound
 * SMS/MMS webhook (POST /destiny/r) and the delivery-status callback
 * (POST /destiny/s). Twilio sends many more fields; only the ones read here
 * are modeled. MediaContentType{N}/MediaUrl{N} are dynamic, indexed by
 * NumMedia, hence the index signature.
 * @typedef {{
 *   From: string,
 *   Body?: string,
 *   NumMedia?: string,
 *   SmsSid?: string,
 *   SmsStatus?: string,
 *   To?: string,
 *   MessageStatus?: string,
 *   ClaimCheck?: string,
 * } & Record<string, string | undefined>} TwilioWebhookBody
 */

/**
 * Constructor options for TwilioController.
 * @typedef {Object} TwilioControllerOptions
 * @property {import('../authentication/authentication.service.js').default} authenticationService
 * @property {import('../destiny2/destiny2.service.js').default} destinyService
 * @property {import('./mms.service.js').default} mmsService
 * @property {import('../users/user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * Twilio Controller
 */
class TwilioController {
    /**
     * @constructor
     * @param {TwilioControllerOptions} options
     */
    constructor(options) {
        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.mms = options.mmsService;
        this.users = options.userService;
        this.world = options.worldRepository;

        /**
         * Only 'more' has a handler; 'rank'/'stars'/'votes' were removed at
         * some point but never cleaned up here, so they crashed request()
         * with a generic TypeError instead of falling through to item search.
         * @type {Map<string, ItemKeywordHandler>}
         */
        this.itemKeywords = new Map([['more', TwilioController.getMore]]);

        /**
         * Concurrency of one keeps consent writes off each other's toes in the
         * common case, but it does not order them: a job that fails moves to
         * the delayed set and can resume after a later one has already run.
         * The `receivedAt` watermark in `applyConsent` is what actually
         * decides which intent wins.
         */
        subscriber.listen(
            ({ phoneNumber, isSubscribed, receivedAt }) =>
                this.applyConsent(phoneNumber, isSubscribed, receivedAt),
            CONSENT_QUEUE,
            { concurrency: 1 },
        );
    }

    /**
     * Search database.
     * @param {ItemDefinition} item
     * @returns {Promise<ItemResult[]>}
     */
    async #getItem(item) {
        const {
            defaultDamageTypeHash,
            displayProperties: { icon, name } = {},
            hash,
            inventory: { tierTypeName = '' } = {},
            itemCategoryHashes = [],
            itemType,
            itemTypeDisplayName,
        } = item;
        const itemCategories = /** @type {import('../helpers/world2.js').CategoryDefinition[]} */ (
            (
                await Promise.all(
                    itemCategoryHashes.map(
                        async itemCategoryHash =>
                            await this.world.getItemCategory(itemCategoryHash),
                    ),
                )
            ).filter(Boolean)
        );
        const filteredCategories = itemCategories.filter(
            ({ hash: categoryHash }) => categoryHash > 1,
        );
        const sortedCategories = filteredCategories.toSorted((a, b) => a.hash - b.hash);
        const itemCategory = sortedCategories
            .reduce((memo, { shortTitle = '' }) => `${memo + shortTitle} `, ' ')
            .trim();
        let damageType;

        if (defaultDamageTypeHash) {
            const damageTypeDefinition =
                await this.world.getDamageTypeByHash(defaultDamageTypeHash);

            damageType = damageTypeDefinition?.displayProperties?.name;
        }

        return [
            {
                itemCategory: `${tierTypeName} ${damageType ? `${damageType} ` : ''}${itemCategory}${
                    filteredCategories.length < 2 ? `${itemTypeDisplayName ?? ''}` : ''
                }`,
                icon: icon ? `https://www.bungie.net${icon}` : undefined,
                itemHash: hash,
                itemName: name ?? '',
                itemType,
            },
        ];
    }

    /**
     * @param {string | undefined} itemHash
     * @param {Record<string, string | undefined>} [cookies]
     * @returns {Promise<TwilioReply>}
     */
    static async getMore(itemHash, cookies = {}) {
        if (itemHash) {
            const shortURL = await getShortUrl(`https://www.light.gg/db/items/${itemHash}`);

            return {
                cookies,
                message: `light.gg\n${shortURL}`,
            };
        }

        return {
            cookies,
            message: 'More what?',
        };
    }

    /**
     * Random responses for unexpected errors.
     * @returns {string}
     * @private
     */
    static getRandomResponseForAnError() {
        const responses = [
            'Sorry. I lost your message in the Ascendant realm. Blame Oryx.',
            'Skolas escaped the Prison of Elders again. He must be responsible for this mishap.',
            "Have you seen that fragment of Crota's soul laying around? Uh oh.",
            "Atheon's plugged into the power grid again. We're experiencing intermittent outages.",
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }

    /**
     * Get a random response to reply when nothing was found.
     * @returns {string}
     * @private
     */
    static getRandomResponseForNoResults() {
        const responses = [
            "Are you sure that's how it's spelled?",
            'Does it look like a Gjallarhorn?',
            "Sorry, I've got nothing.",
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }

    /**
     * Get Xur's inventory.
     *
     * @param {UserDocument} user
     * @param {Record<string, string | undefined>} cookies
     * @returns {Promise<TwilioReply>}
     * @memberof TwilioController
     */
    async getXur(user, cookies) {
        try {
            const authenticatedUser = await this.authentication.authenticate(user);

            if (!authenticatedUser) {
                return {
                    cookies,
                    message: `Reconnect your Bungie account at ${process.env.WEBSITE}/register`,
                };
            }

            const { bungie, membershipId, membershipType } = authenticatedUser;
            const { access_token: accessToken } =
                /** @type {NonNullable<UserDocument['bungie']>} */ (bungie);
            const characters = await this.destiny.getProfile(membershipId, membershipType);

            if (characters?.length) {
                const itemHashes = await this.destiny.getXur(
                    membershipId,
                    membershipType,
                    characters[0].characterId,
                    /** @type {string} */ (accessToken),
                );
                const weaponCategory = await this.world.getWeaponCategory();
                const items = /** @type {ItemDefinition[]} */ (
                    (
                        await Promise.all(
                            itemHashes.map(itemHash => this.world.getItemByHash(itemHash)),
                        )
                    ).filter(Boolean)
                );
                const weapons = items.filter(({ itemCategoryHashes = [] }) =>
                    itemCategoryHashes.includes(weaponCategory),
                );
                const result = weapons
                    .reduce(
                        (memo, { displayProperties }) =>
                            `${memo + (displayProperties?.name ?? '')}\n`,
                        ' ',
                    )
                    .trim();

                return {
                    cookies: { ...cookies, itemHash: undefined },
                    message: result.substring(0, MAX_SMS_MESSAGE_LENGTH),
                };
            }

            return {
                cookies,
                message: 'Perhaps your Ghost can help you find what you need.',
            };
        } catch (err) {
            if (err instanceof DestinyError) {
                return {
                    cookies,
                    message: err.message.substring(0, MAX_SMS_MESSAGE_LENGTH),
                };
            }

            log.error(err);

            return {
                cookies,
                message: TwilioController.getRandomResponseForNoResults(),
            };
        }
    }

    /**
     * Search for an item that matches the name provided.
     * @param {string} itemName
     * @returns {Promise<(ItemDefinition | ItemResult)[]>}
     */
    async queryItem(itemName) {
        const allItems = await this.world.getItemByName(itemName.replace(/[\u2018\u2019]/g, "'"));
        const items = allItems.filter(
            ({ itemType }) => !itemName.includes('Catalyst') && [2, 3, 4].includes(itemType ?? -1),
        );

        if (items.length > 0) {
            if (items.length > 1) {
                const groups = Object.groupBy(items, item => item.itemName ?? '');
                const keys = Object.keys(groups);

                if (keys.length === 1) {
                    return await this.#getItem(items[0]);
                }

                return items;
            }

            return await this.#getItem(items[0]);
        }

        return [];
    }

    /**
     * @returns {string}
     */
    static fallback() {
        return TwilioController.getRandomResponseForAnError();
    }

    /**
     * Hand a consent change to the durable queue, falling back to writing it
     * here when the queue cannot take it.
     *
     * The reply has already gone out - carriers require STOP to be answered
     * whatever the database is doing - so a change that only lives in this
     * process is lost to any restart inside the retry window. Queueing it
     * moves that state into Redis, where a restarted worker picks it up.
     *
     * If the queue itself is unreachable, writing inline is strictly better
     * than dropping the change, so the fallback keeps the previous behaviour
     * rather than depending on Redis being up.
     * @param {string} phoneNumber
     * @param {boolean} isSubscribed
     * @param {number} receivedAt - Epoch milliseconds the message arrived.
     * @returns {Promise<void>}
     */
    async #persistConsent(phoneNumber, isSubscribed, receivedAt) {
        try {
            await enqueueConsentChange({ phoneNumber, isSubscribed, receivedAt });
        } catch (err) {
            log.warn(
                { err, phoneNumber, isSubscribed },
                'Unable to queue SMS consent change; writing it inline instead.',
            );

            /**
             * Nothing upstream can retry this one - the reply has gone and
             * there is no job to hand back - so a terminal failure ends here.
             * `applyConsent` has already logged it with the number.
             */
            await this.applyConsent(phoneNumber, isSubscribed, receivedAt).catch(() => {});
        }
    }

    /**
     * Write a consent change, retrying what is worth retrying.
     *
     * Shared by the queue worker and by `#persistConsent`'s fallback, so both
     * routes to the database behave identically. A dropped write is invisible
     * to the sender: they are told they are unsubscribed while
     * `getSubscribedUsers` still returns them for the next broadcast.
     *
     * Rejects when the change could not be persisted, having logged it with
     * the number. That rejection is what lets the worker hand the job back to
     * BullMQ: swallowing it here would mark every job completed, so the
     * queue's `attempts` and `removeOnFail` retention would never apply and an
     * outage lasting longer than the in-process retries would drop the change
     * with the job quietly removed. The inline fallback, which has no job to
     * hand back, catches it instead.
     * @param {string} phoneNumber
     * @param {boolean} isSubscribed
     * @param {number} receivedAt - Epoch milliseconds the message arrived.
     * @returns {Promise<void>}
     * @throws when the change could not be written
     */
    async applyConsent(phoneNumber, isSubscribed, receivedAt) {
        try {
            await withRetry(
                async () => {
                    /**
                     * Read through to Cosmos rather than the cache. A cached
                     * document can carry an etag Cosmos has already replaced,
                     * which fails the write's precondition - and would fail
                     * identically on every retry for the rest of the cache's
                     * hour. Consent changes arrive only on STOP/START, so the
                     * extra read costs nothing worth counting.
                     */
                    const user = await this.users.getUserByPhoneNumber(phoneNumber, true);

                    if (!user) {
                        return;
                    }

                    /**
                     * Worker concurrency orders jobs only while they are
                     * active: a failed STOP waits out its backoff in the
                     * delayed set while a later START runs, then wakes and
                     * would otherwise overwrite it. The inline fallback
                     * sidesteps the worker altogether. Comparing against the
                     * stamp already stored settles both, and survives a
                     * restart because it lives on the document.
                     *
                     * Strictly older loses; a tie is applied. Two messages
                     * sharing a millisecond cannot be ordered by arrival at
                     * all, so the one processed later wins rather than the
                     * earlier one keeping the field by virtue of getting there
                     * first. A redelivered job carries the intent it already
                     * wrote, so reapplying it changes nothing.
                     *
                     * The stamp is wall clock, taken where the message
                     * arrives. That orders anything a single process handles;
                     * across several, it is only as good as their clocks. A
                     * monotonic per-number sequence would not have that limit,
                     * but assigning one means a counter read before the reply,
                     * which is the dependency this path exists to avoid - and
                     * it would be unavailable in exactly the outage the inline
                     * fallback covers.
                     */
                    if (
                        typeof user.consentUpdatedAt === 'number' &&
                        user.consentUpdatedAt > receivedAt
                    ) {
                        return;
                    }

                    /**
                     * Written even when `isSubscribed` is unchanged, because
                     * the stamp has to move forward: leaving it behind would
                     * let an older intent still in backoff win afterwards.
                     */
                    await this.users.updateUserSubscription(user, isSubscribed, receivedAt);
                },
                {
                    maxRetries: CONSENT_WRITE_RETRIES,
                    baseDelay: CONSENT_WRITE_BASE_DELAY_MS,
                    shouldRetry: isRetryableConsentError,
                },
            );
        } catch (err) {
            log.error(
                { err, phoneNumber, isSubscribed },
                'Unable to persist SMS consent change after retrying; the sender was told it applied.',
            );

            throw err;
        }
    }

    /**
     * @param {{ body: TwilioWebhookBody, cookies: Record<string, string | undefined> }} param0
     * @returns {Promise<TwilioReply>}
     */
    async request({ body, cookies }) {
        let responseCookies = {};
        /**
         * `bodySchema` in twilio.routes.js requires `Body` for this route
         * (POST /destiny/r); it's optional on `TwilioWebhookBody` only
         * because the status-callback route (POST /destiny/s) shares the
         * type and doesn't send `Body`.
         */
        const rawMessage = /** @type {string} */ (body.Body).trim();
        const emojiMatches = extractEmoji(rawMessage);
        /**
         * Emoji are stripped before keyword/search matching so a message like
         * "gjallarhorn 🔥" resolves the same way "gjallarhorn" would. Stripping
         * also normalizes surrounding whitespace, so it's only applied when
         * emoji are actually present - messages with no emoji at all are left
         * completely untouched (no incidental whitespace collapsing, no
         * redundant regex pass). Emoji-only messages are handled separately
         * below, before falling through to item search.
         */
        const strippedMessage = emojiMatches.length ? stripEmoji(rawMessage) : rawMessage;
        const message = strippedMessage.toLowerCase();

        /**
         * Carrier compliance requires STOP/HELP/START to work for any inbound
         * number. Replies must not wait for user lookup or best-effort
         * persistence. The arrival time is taken here, before any of it, so
         * two messages from one number are ordered by when they reached us
         * rather than by which write happened to finish first.
         */
        const receivedAt = Temporal.Now.instant().epochMilliseconds;

        if (STOP_KEYWORDS.has(message)) {
            void this.#persistConsent(body.From, false, receivedAt);
            return { message: STOP_REPLY };
        }

        if (HELP_KEYWORDS.has(message)) {
            return { message: HELP_REPLY };
        }

        if (START_KEYWORDS.has(message)) {
            void this.#persistConsent(body.From, true, receivedAt);
            return { message: START_REPLY };
        }

        const user = await this.users.getUserByPhoneNumber(body.From);

        if (user?.isSubscribed === false) {
            return {};
        }

        if (!user?.dateRegistered) {
            if (!cookies.isRegistered) {
                return {
                    message: `Register your phone at ${process.env.WEBSITE}/register`, // ToDo
                };
            }

            return {};
        }

        responseCookies = { isRegistered: 'true', ...responseCookies };
        // SmsStatus is a standard Twilio field on every inbound SMS/MMS webhook,
        // even though bodySchema (twilio.routes.js) doesn't validate it (SmsSid is).
        await this.users.addUserMessage(
            /** @type {Omit<import('../users/user.service.js').UserMessage, 'id'>} */ (body),
        );

        const numMedia = Number(body.NumMedia) || 0;

        if (numMedia > 0) {
            const media = Array.from({ length: numMedia }, (_, index) => ({
                contentType: body[`MediaContentType${index}`],
                url: body[`MediaUrl${index}`],
            })).filter(
                /** @returns {item is import('./mms.service.js').MmsMedia} */
                item => Boolean(item.url && item.contentType?.startsWith('image/')),
            );

            if (!media.length) {
                return { cookies: responseCookies, message: MEDIA_UNSUPPORTED_REPLY };
            }

            /**
             * Deliberately not awaited: downloading and analyzing can exceed
             * Twilio's webhook timeout, so acknowledge now and let the
             * processing (which handles its own errors) finish in the
             * background.
             */
            void this.mms.process({ from: body.From, media });

            return { cookies: responseCookies, message: MEDIA_RECEIVED_REPLY };
        }

        const { itemHash } = cookies;

        if (emojiMatches.length && !strippedMessage) {
            const reply =
                EMOJI_INTENT_REPLIES.get(normalizeEmoji(emojiMatches[0])) ?? EMOJI_DEFAULT_REPLY;

            return { cookies: responseCookies, message: reply };
        }

        if (this.itemKeywords.has(message)) {
            const handler = /** @type {ItemKeywordHandler} */ (this.itemKeywords.get(message));

            return await handler.bind(this)(itemHash, responseCookies);
        }

        if (message === 'xur') {
            return await this.getXur(user, responseCookies);
        }

        const items = await this.queryItem(message);

        switch (items.length) {
            case 0: {
                return {
                    cookies: responseCookies,
                    message: TwilioController.getRandomResponseForNoResults(),
                };
            }
            case 1: {
                // A single result is always the #getItem() detail shape, never
                // the raw manifest item - see queryItem()'s branches.
                const item = /** @type {ItemResult} */ (items[0]);

                responseCookies = {
                    itemHash: item.itemHash !== undefined ? String(item.itemHash) : undefined,
                    ...responseCookies,
                };
                item.itemCategory = (item.itemCategory ?? '').replace(/Weapon/g, '').trim();

                return {
                    cookies: responseCookies,
                    message: `${item.itemName} ${item.itemCategory}`.substring(
                        0,
                        MAX_SMS_MESSAGE_LENGTH,
                    ),
                    media: user.type === 'landline' ? undefined : item.icon,
                };
            }
            default: {
                const groups = Object.groupBy(items, item => item.itemName ?? '');
                const keys = Object.keys(groups);
                const result = keys
                    .reduce(
                        (memo, key) => `${memo}\n${key} ${groups[key]?.[0]?.itemCategory ?? ''}`,
                        ' ',
                    )
                    .trim();

                return {
                    cookies: { itemHash: undefined, ...responseCookies },
                    message: result.substring(0, MAX_SMS_MESSAGE_LENGTH),
                };
            }
        }
    }

    /**
     * @param {TwilioWebhookBody} message
     * @returns {Promise<void>}
     */
    async statusCallback(message) {
        const {
            ClaimCheck: claimCheck,
            MessageStatus: messageStatus,
            SmsStatus: smsStatus,
            To: phoneNumber,
        } = message;
        // This webhook's payload carries MessageStatus, not SmsStatus - fall
        // back to a legacy SmsStatus field if Twilio ever sends one instead.
        const status = messageStatus ?? smsStatus;

        if (!phoneNumber || !status) {
            log.warn({ message }, 'Ignoring status callback missing To or status.');

            return;
        }

        const user = await this.users.getUserByPhoneNumber(phoneNumber);

        if (user) {
            await this.users.addUserMessage(
                /** @type {Omit<import('../users/user.service.js').UserMessage, 'id'>} */ ({
                    ...message,
                    SmsStatus: status,
                }),
            );
            if (claimCheck) {
                await ClaimCheck.updatePhoneNumber(claimCheck, phoneNumber, status);
            }
        }
    }
}

export default TwilioController;
