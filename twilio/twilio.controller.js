/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 */
const _ = require('underscore');
const twilio = require('twilio');
const { twiml: { MessagingResponse } } = require('twilio');
const bitly = require('../helpers/bitly');
const log = require('../helpers/log');

const { attributes, authToken } = require(`../settings/twilio.${process.env.NODE_ENV}.json`); // eslint-disable-line import/no-dynamic-require

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
    }

    /**
     * Search database.
     * @param item {string}
     * @returns {Promise}
     * @private
     */
    async _getItem(item) {
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
                filteredCategories.length < 2 ? (` ${itemTypeDisplayName}`) : ''}`,
            icon: `https://www.bungie.net${icon}`,
            itemHash: hash,
            itemName: name,
            itemType,
        }];
    }

    /**
     * Random responses for unexpected errors.
     * @returns {string}
     * @private
     */
    static _getRandomResponseForAnError() {
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
    static _getRandomResponseForNoResults() {
        const responses = [
            'Are you sure that\'s how it\'s spelled?',
            'Does it look like a Gjallarhorn?',
            'Sorry, I\'ve got nothing.',
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }

    /**
     * Search for an item that matches the name provided.
     * @param itemName
     * @returns {Promise}
     */
    async _queryItem(itemName) {
        const allItems = await this.world.getItemByName(itemName.replace(/[\u2018\u2019]/g, '\''));
        const items = allItems.filter(({ itemType }) => !itemName.includes('Catalyst')
            && [2, 3, 4].includes(itemType));

        if (items.length > 0) {
            if (items.length > 1) {
                const groups = _.groupBy(items, item => item.itemName);
                const keys = Object.keys(groups);

                if (keys.length === 1) {
                    return this._getItem(items[0]); // eslint-disable-line no-underscore-dangle
                }

                return items;
            }

            return this._getItem(items[0]); // eslint-disable-line no-underscore-dangle
        }

        return [];
    }

    /**
     *
     * @param req
     * @param res
     */
    static async fallback(req, res) {
        const header = req.headers['x-twilio-signature'];
        const twiml = new MessagingResponse();

        // eslint-disable-next-line max-len
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            twiml.message(attributes, TwilioController._getRandomResponseForAnError()); // eslint-disable-line no-underscore-dangle, max-len
            res.writeHead(200, {
                'Content-Type': 'text/xml',
            });
        } else {
            res.writeHead(403, {
                'Content-Type': 'text/xml',
            });
        }

        res.end(twiml.toString());
    }

    /**
     *
     * @param req
     * @param res
     */
    async request(req, res) {
        const header = req.headers['x-twilio-signature'];
        const twiml = new MessagingResponse();
        const {
            body,
            cookies = {},
            originalUrl,
        } = req;

        // eslint-disable-next-line max-len
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + originalUrl, body)) {
            let counter = parseInt(cookies.counter, 10) || 0;
            const user = await this.users.getUserByPhoneNumber(body.From);

            if (!user || !user.dateRegistered) {
                if (!cookies.isRegistered) {
                    twiml.message(`Register your phone at ${process.env.WEBSITE}/register`);
                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });

                    return res.end(twiml.toString());
                }

                res.writeHead(403);
                return res.end();
            }

            res.cookie('isRegistered', true);
            await this.users.addUserMessage(user.displayName, user.membershipType, body);

            const { Body: rawMessage } = body;
            const { itemHash } = cookies;
            const message = rawMessage.trim().toLowerCase();

            /**
             * @ToDo Handle STOP and HELP
             */
            if (['more', 'rank', 'votes'].includes(message)) {
                if (message === 'more') {
                    if (itemHash) {
                        const shortURL = await bitly.getShortUrl(`http://db.destinytracker.com/d2/en/items/${itemHash}`);

                        twiml.message(attributes, `Destiny Tracker\n${shortURL}`);
                        res.writeHead(200, {
                            'Content-Type': 'text/xml',
                        });

                        return res.end(twiml.toString());
                    }

                    twiml.message(attributes, 'More what?');
                }

                if (message === 'rank') {
                    if (itemHash) {
                        const rank = await this.destinyTracker.getRank(itemHash);

                        if (rank) {
                            const suffixes = ['th', 'st', 'nd', 'rd'];
                            const mod = rank % 100;

                            twiml.message(attributes, `${rank + (suffixes[(mod - 20) % 10] || suffixes[mod] || suffixes[0])} in PVP`);
                            res.writeHead(200, {
                                'Content-Type': 'text/xml',
                            });

                            return res.end(twiml.toString());
                        }
                    }

                    twiml.message(attributes, 'Hm, I didn\'t find a PVP ranking for that item.');
                }

                if (message === 'votes') {
                    if (itemHash) {
                        const { upvotes, total } = await this.destinyTracker.getVotes(itemHash);

                        twiml.message(attributes, `${upvotes} of ${total} 👍`);
                        res.writeHead(200, {
                            'Content-Type': 'text/xml',
                        });

                        return res.end(twiml.toString());
                    }

                    twiml.message(attributes, 'Strange. They must still be counting.');
                }

                res.writeHead(200, {
                    'Content-Type': 'text/xml',
                });

                return res.end(twiml.toString());
            }

            if (message === 'xur') {
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

                        twiml.message(attributes, result.substr(0, 130));
                        res.clearCookie('itemHash');
                        res.writeHead(200, {
                            'Content-Type': 'text/xml',
                        });

                        return res.end(twiml.toString());
                    }
                } catch (err) {
                    if (err.name === 'DestinyError') {
                        twiml.message(attributes, err.message.substr(0, 130));
                        res.writeHead(200, {
                            'Content-Type': 'text/xml',
                        });

                        return res.end(twiml.toString());
                    }

                    log.error(err);

                    twiml.message(attributes, TwilioController._getRandomResponseForNoResults()); // eslint-disable-line no-underscore-dangle, max-len
                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });

                    return res.end(twiml.toString());
                }
            } else if (counter > 25) {
                twiml.message(attributes, 'Let me check with the Speaker regarding your good standing with the Vanguard.');
                res.writeHead(429, {
                    'Content-Type': 'text/xml',
                });

                return res.end(twiml.toString());
            } else {
                const searchTerm = body.Body.trim().toLowerCase();
                const items = await this._queryItem(searchTerm); // eslint-disable-line no-underscore-dangle, max-len

                counter += 1;
                res.cookie('counter', counter);
                switch (items.length) {
                case 0: {
                    twiml.message(attributes, TwilioController._getRandomResponseForNoResults()); // eslint-disable-line no-underscore-dangle, max-len
                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });

                    return res.end(twiml.toString());
                }
                case 1: {
                    res.cookie('itemHash', items[0].itemHash);
                    items[0].itemCategory = items[0].itemCategory.replace(/Weapon/g, '').trim();

                    if (user.type === 'landline') {
                        twiml.message(attributes, `${items[0].itemName} ${items[0].itemCategory}`.substr(0, 130));
                    } else {
                        twiml.message(attributes,
                            `${items[0].itemName} ${items[0].itemCategory}`.substr(0, 130)).media(items[0].icon);
                    }
                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });

                    return res.end(twiml.toString());
                }
                default: {
                    const groups = _.groupBy(items, item => item.itemName);
                    const keys = Object.keys(groups);
                    const result = _.reduce(keys, (memo, key) => `${memo}\n${key} ${groups[key][0].itemCategory}`, ' ').trim();

                    twiml.message(attributes, result.substr(0, 130));
                    res.clearCookie('itemHash');
                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });

                    return res.end(twiml.toString());
                }
                }
            }
        }

        res.writeHead(403);

        return res.end();
    }

    /**
     *
     * @param req
     * @param res
     */
    async statusCallback(req, res) {
        const header = req.headers['x-twilio-signature'];
        const twiml = new MessagingResponse();

        // eslint-disable-next-line max-len
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            this.users.getUserByPhoneNumber(req.body.To)
                .then(user => {
                    if (user) {
                        // eslint-disable-next-line max-len
                        this.users.addUserMessage(user.displayName, user.membershipType, req.body);
                    }
                });
            log.info(JSON.stringify(req.body));
            res.writeHead(200, {
                'Content-Type': 'text/xml',
            });
        } else {
            res.writeHead(403, {
                'Content-Type': 'text/xml',
            });
        }

        res.end(twiml.toString());
    }
}

module.exports = TwilioController;
