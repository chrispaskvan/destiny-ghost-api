/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 */
const _ = require('underscore');

const bitly = require('../helpers/bitly');
const log = require('../helpers/log');

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
        this.destinyTracker = options.destinyTrackerService;
        this.users = options.userService;
        this.world = options.worldRepository;

        this.itemKeywords = new Map([
            ['more', this.constructor.getMore],
            ['votes', this.getVotes],
            ['rank', this.getRank],
        ]);
    }

    /**
     * Search database.
     * @param item {string}
     * @returns {Promise}
     * @private
     */
    async getItem(item) {
        const {
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
        const promises = itemCategoryHashes.map(itemCategoryHash => this.world
            .getItemCategory(itemCategoryHash));
        const itemCategories = await Promise.all(promises);
        const filteredCategories = itemCategories.filter(({ hash1 }) => hash1 > 1);
        const sortedCategories = _.sortBy(filteredCategories,
            itemCategory => itemCategory.hash);
        const itemCategory = _.reduce(sortedCategories, (memo, { shortTitle }) => (`${memo + shortTitle} `), ' ')
            .trim();

        return [{
            itemCategory: `${tierTypeName} ${itemCategory}${
                filteredCategories.length < 2 ? `${itemTypeDisplayName}` : ''}`,
            icon: `https://www.bungie.net${icon}`,
            itemHash: hash,
            itemName: name,
            itemType,
        }];
    }

    static async getMore(itemHash, cookies = {}) {
        if (itemHash) {
            const shortURL = await bitly.getShortUrl(`http://db.destinytracker.com/d2/en/items/${itemHash}`);

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

    async getRank(itemHash, cookies = {}) {
        if (itemHash) {
            const rank = await this.destinyTracker.getRank(itemHash);

            if (rank) {
                const suffixes = ['th', 'st', 'nd', 'rd'];
                const mod = rank % 100;

                return {
                    cookies,
                    message: `${rank + (suffixes[(mod - 20) % 10] || suffixes[mod] || suffixes[0])} in PVP`,
                };
            }
        }

        return {
            message: 'Hm, I didn\'t find a PVP ranking for that item.',
        };
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

    async getVotes(itemHash, cookies = {}) {
        if (itemHash) {
            const { upvotes, total } = await this.destinyTracker.getVotes(itemHash) || {};

            if (upvotes && total) {
                return {
                    cookies,
                    message: `${upvotes} of ${total} 👍`,
                };
            }
        }

        return {
            cookies,
            message: 'Strange. They must still be counting.',
        };
    }

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
                    .getXur(membershipId, membershipType, characters[0].characterId, accessToken); // eslint-disable-line max-len
                const items = await Promise.all(itemHashes
                    .map(itemHash1 => this.world.getItemByHash(itemHash1)));
                const result = _.reduce(items, (memo, { displayProperties }) => (`${memo + displayProperties.name}\n`), ' ').trim();

                return {
                    cookies: { ...cookies, itemHash: undefined },
                    message: result.substr(0, 130), // ToDo: Is this still necessary?
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
                    message: err.message.substr(0, 130),
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
                const groups = _.groupBy(items, item => item.itemName);
                const keys = Object.keys(groups);

                if (keys.length === 1) {
                    return this.getItem(items[0]);
                }

                return items;
            }

            return this.getItem(items[0]);
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
        await this.users.addUserMessage(user.displayName, user.membershipType, body);

        const { Body: rawMessage } = body;
        const { itemHash } = cookies;
        const message = rawMessage.trim().toLowerCase();

        /**
         * @ToDo: Handle STOP and HELP
         */
        if (this.itemKeywords.has(message)) {
            return this.itemKeywords.get(message).bind(this)(itemHash, responseCookies);
        }

        if (message === 'xur') {
            return this.getXur(user, responseCookies);
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
                message: `${items[0].itemName} ${items[0].itemCategory}`.substr(0, 130),
                media: user.type === 'landline' ? undefined : items[0].icon,
            };
        }
        default: {
            const groups = _.groupBy(items, item => item.itemName);
            const keys = Object.keys(groups);
            const result = _.reduce(keys, (memo, key) => `${memo}\n${key} ${groups[key][0].itemCategory}`, ' ').trim();

            return {
                cookies: { itemHash: undefined, ...responseCookies },
                message: result.substr(0, 130),
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
        const { To: phoneNumber } = message;
        const user = await this.users.getUserByPhoneNumber(phoneNumber);

        if (user) {
            await this.users.addUserMessage(user.displayName, user.membershipType, message);
        }
    }
}

module.exports = TwilioController;
