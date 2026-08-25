/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 */
import ClaimCheck from '../helpers/claim-check.js';
import getShortUrl from '../helpers/bitly.js';
import log from '../helpers/log.js';
import { extractEmoji, stripEmoji } from '../helpers/emoji.js';
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

/**
 * Twilio Controller
 */
class TwilioController {
    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.mms = options.mmsService;
        this.users = options.userService;
        this.world = options.worldRepository;

        this.itemKeywords = new Map([
            ['more', this.constructor.getMore],
            ['rank', this.getRank],
            ['stars', this.getStars],
            ['votes', this.getVotes],
        ]);
    }

    /**
     * Search database.
     * @param item {string}
     * @returns {Promise}
     * @private
     */
    async #getItem(item) {
        const {
            defaultDamageTypeHash,
            displayProperties: { icon, name } = {},
            hash,
            inventory: { tierTypeName = '' } = {},
            itemCategoryHashes,
            itemType,
            itemTypeDisplayName,
        } = item;
        const itemCategories = await Promise.all(
            itemCategoryHashes.map(
                async itemCategoryHash => await this.world.getItemCategory(itemCategoryHash),
            ),
        );
        const filteredCategories = itemCategories.filter(({ hash1 }) => hash1 > 1);
        const sortedCategories = filteredCategories.toSorted((a, b) => a.hash - b.hash);
        const itemCategory = sortedCategories
            .reduce((memo, { shortTitle }) => `${memo + shortTitle} `, ' ')
            .trim();
        let damageType;

        if (defaultDamageTypeHash) {
            ({
                displayProperties: { name: damageType } = {},
            } = await this.world.getDamageTypeByHash(defaultDamageTypeHash));
        }

        return [
            {
                itemCategory: `${tierTypeName} ${damageType ? `${damageType} ` : ''}${itemCategory}${
                    filteredCategories.length < 2 ? `${itemTypeDisplayName}` : ''
                }`,
                icon: `https://www.bungie.net${icon}`,
                itemHash: hash,
                itemName: name,
                itemType,
            },
        ];
    }

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
     * @param {*} user
     * @param {*} cookies
     * @returns
     * @memberof TwilioController
     */
    async getXur(user, cookies) {
        try {
            const {
                bungie: { access_token: accessToken },
                membershipId,
                membershipType,
            } = await this.authentication.authenticate(user);
            const characters = await this.destiny.getProfile(membershipId, membershipType);

            if (characters?.length) {
                const itemHashes = await this.destiny.getXur(
                    membershipId,
                    membershipType,
                    characters[0].characterId,
                    accessToken,
                );
                const weaponCategory = await this.world.getWeaponCategory();
                const items = await Promise.all(
                    itemHashes.map(itemHash => this.world.getItemByHash(itemHash)),
                );
                const weapons = items.filter(({ itemCategoryHashes }) =>
                    itemCategoryHashes.includes(weaponCategory),
                );
                const result = weapons
                    .reduce(
                        (memo, { displayProperties }) => `${memo + displayProperties.name}\n`,
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
            if (err.name === 'DestinyError') {
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
     * @param itemName
     * @returns {Promise}
     */
    async queryItem(itemName) {
        const allItems = await this.world.getItemByName(itemName.replace(/[\u2018\u2019]/g, "'"));
        const items = allItems.filter(
            ({ itemType }) => !itemName.includes('Catalyst') && [2, 3, 4].includes(itemType),
        );

        if (items.length > 0) {
            if (items.length > 1) {
                const groups = Object.groupBy(items, item => item.itemName);
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
     *
     * @param req
     * @param res
     */
    static fallback() {
        return TwilioController.getRandomResponseForAnError();
    }

    /**
     *
     * @param req
     * @param res
     */
    async request({ body, cookies }) {
        let responseCookies = {};
        const user = await this.users.getUserByPhoneNumber(body.From);
        const rawMessage = body.Body.trim();
        const emojiMatches = extractEmoji(rawMessage);
        const strippedMessage = stripEmoji(rawMessage);
        /**
         * Emoji are stripped before keyword/search matching so a message like
         * "gjallarhorn 🔥" resolves the same way it would without the emoji.
         * Emoji-only messages are handled separately below, before falling
         * through to item search.
         */
        const message = strippedMessage.toLowerCase();

        /**
         * Carrier compliance requires STOP/HELP/START to work for any inbound
         * number, not just ones with an existing user record - persistence is
         * the only part conditional on `user`.
         */
        if (STOP_KEYWORDS.has(message)) {
            if (user) {
                await this.users.updateUser({ ...user, isSubscribed: false });
            }

            return { message: STOP_REPLY };
        }

        if (HELP_KEYWORDS.has(message)) {
            return { message: HELP_REPLY };
        }

        if (START_KEYWORDS.has(message)) {
            if (user) {
                await this.users.updateUser({ ...user, isSubscribed: true });
            }

            return { message: START_REPLY };
        }

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

        responseCookies = { isRegistered: true, ...responseCookies };
        await this.users.addUserMessage(body);

        const numMedia = Number(body.NumMedia) || 0;

        if (numMedia > 0) {
            const media = Array.from({ length: numMedia }, (_, index) => ({
                contentType: body[`MediaContentType${index}`],
                url: body[`MediaUrl${index}`],
            })).filter(({ contentType, url }) => url && contentType?.startsWith('image/'));

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
            const reply = EMOJI_INTENT_REPLIES.get(emojiMatches[0]) ?? EMOJI_DEFAULT_REPLY;

            return { cookies: responseCookies, message: reply };
        }

        if (this.itemKeywords.has(message)) {
            return await this.itemKeywords.get(message).bind(this)(itemHash, responseCookies);
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
                responseCookies = { itemHash: items[0].itemHash, ...responseCookies };
                items[0].itemCategory = items[0].itemCategory.replace(/Weapon/g, '').trim();

                return {
                    cookies: responseCookies,
                    message: `${items[0].itemName} ${items[0].itemCategory}`.substring(
                        0,
                        MAX_SMS_MESSAGE_LENGTH,
                    ),
                    media: user.type === 'landline' ? undefined : items[0].icon,
                };
            }
            default: {
                const groups = Object.groupBy(items, item => item.itemName);
                const keys = Object.keys(groups);
                const result = keys
                    .reduce((memo, key) => `${memo}\n${key} ${groups[key][0].itemCategory}`, ' ')
                    .trim();

                return {
                    cookies: { itemHash: undefined, ...responseCookies },
                    message: result.substring(0, MAX_SMS_MESSAGE_LENGTH),
                };
            }
        }
    }

    /**
     *
     * @param req
     * @param res
     */
    async statusCallback(message) {
        const { ClaimCheck: claimCheck, MessageStatus: status, To: phoneNumber } = message;
        const user = await this.users.getUserByPhoneNumber(phoneNumber);

        if (user) {
            await this.users.addUserMessage(message);
            if (claimCheck) {
                await ClaimCheck.updatePhoneNumber(claimCheck, phoneNumber, status);
            }
        }
    }
}

export default TwilioController;
