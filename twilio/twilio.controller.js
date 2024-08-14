/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 */
import groupBy from 'lodash/groupBy';
import sortBy from 'lodash/sortBy';

import ClaimCheck from '../helpers/claim-check';
import getShortUrl from '../helpers/bitly';
import log from '../helpers/log';
import { MAX_SMS_MESSAGE_LENGTH } from './twilio.constants';

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
            displayProperties: {
                icon,
                name,
            } = {},
            hash,
            inventory: {
                tierTypeName = '',
            } = {},
            itemCategoryHashes,
            itemType,
            itemTypeDisplayName,
        } = item;
        const itemCategories = itemCategoryHashes.map(itemCategoryHash => this.world
            .getItemCategory(itemCategoryHash));
        const filteredCategories = itemCategories.filter(({ hash1 }) => hash1 > 1);
        const sortedCategories = sortBy(
            filteredCategories,
            itemCategory => itemCategory.hash,
        );
        const itemCategory = sortedCategories.reduce((memo, { shortTitle }) => (`${memo + shortTitle} `), ' ')
            .trim();
        let damageType;

        if (defaultDamageTypeHash) {
            ({ displayProperties: { name: damageType } = {} } = this.world
                .getDamageTypeByHash(defaultDamageTypeHash));
        }

        return [{
            itemCategory: `${tierTypeName} ${damageType ? `${damageType} ` : ''}${itemCategory}${
                filteredCategories.length < 2 ? `${itemTypeDisplayName}` : ''}`,
            icon: `https://www.bungie.net${icon}`,
            itemHash: hash,
            itemName: name,
            itemType,
        }];
    }

    static async getMore(itemHash, cookies = {}) {
        if (itemHash) {
            const shortURL = await getShortUrl(`https://destinytracker.com/destiny-2/db/items/${itemHash}`);

            return {
                cookies,
                message: `Destiny Tracker\n${shortURL}`,
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
            'Have you seen that fragment of Crota\'s soul laying around? Uh oh.',
            'Atheon\'s plugged into the power grid again. We\'re experiencing intermittent outages.',
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
            'Are you sure that\'s how it\'s spelled?',
            'Does it look like a Gjallarhorn?',
            'Sorry, I\'ve got nothing.',
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
                bungie: {
                    access_token: accessToken,
                },
                membershipId,
                membershipType,
            } = await this.authentication.authenticate(user);
            const characters = await this.destiny.getProfile(membershipId, membershipType);

            if (characters && characters.length) {
                const itemHashes = await this.destiny
                    .getXur(membershipId, membershipType, characters[0].characterId, accessToken);
                const items = itemHashes.map(itemHash => this.world.getItemByHash(itemHash));
                const weapons = items
                    .filter(({ itemCategoryHashes }) => itemCategoryHashes.includes(this.world.weaponCategory));  
                const result = weapons.reduce((memo, { displayProperties }) => (`${memo + displayProperties.name}\n`), ' ').trim();

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
                messsage: TwilioController.getRandomResponseForNoResults(),
            };
        }
    }

    /**
     * Search for an item that matches the name provided.
     * @param itemName
     * @returns {Promise}
     */
    async queryItem(itemName) {
        const allItems = await this.world.getItemByName(itemName.replace(/[\u2018\u2019]/g, '\''));
        const items = allItems.filter(({ itemType }) => !itemName.includes('Catalyst')
            && [2, 3, 4].includes(itemType));

        if (items.length > 0) {
            if (items.length > 1) {
                const groups = groupBy(items, item => item.itemName);
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

        if (!user || !user.dateRegistered) {
            if (!cookies.isRegistered) {
                return {
                    message: `Register your phone at ${process.env.WEBSITE}/register`, // ToDo
                };
            }

            return {};
        }

        responseCookies = { isRegistered: true, ...responseCookies };
        await this.users.addUserMessage(body);

        const { Body: rawMessage } = body;
        const { itemHash } = cookies;
        const message = rawMessage.trim().toLowerCase();

        /**
         * @ToDo: Handle STOP and HELP
         */
        if (this.itemKeywords.has(message)) {
            return await this.itemKeywords.get(message).bind(this)(itemHash, responseCookies);
        }

        if (message === 'xur') {
            return await this.getXur(user, responseCookies);
        }

        const searchTerm = body.Body.trim().toLowerCase();
        const items = await this.queryItem(searchTerm);

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
                message: `${items[0].itemName} ${items[0].itemCategory}`.substring(0, MAX_SMS_MESSAGE_LENGTH),
                media: user.type === 'landline' ? undefined : items[0].icon,
            };
        }
        default: {
            const groups = groupBy(items, item => item.itemName);
            const keys = Object.keys(groups);
             
            const result = keys.reduce((memo, key) => `${memo}\n${key} ${groups[key][0].itemCategory}`, ' ').trim();

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
        const {
            ClaimCheck: claimCheck,
            MessageStatus: status,
            To: phoneNumber,
        } = message;
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
