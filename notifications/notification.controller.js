/**
* A module for sending user notifications.
*
* @module notificationController
* @author Chris Paskvan
* @requires _
* @requires AuthenticationController
* @requires Destiny
* @requires fs
* @requires Ghost
* @requires Notifications
* @requires path
* @requires Q
* @requires User
* @requires World
*/
const _ = require('underscore'),
    { gunSmithHash, lordSaladinHash, xurHash } = require('../destiny/destiny.constants'),
    Ghost = require('../ghost/ghost'),
    headers = require('../settings/notificationHeaders.json'),
    types = require('./notification.types');

/**
* @constructor
* @param loggingProvider
*/
class NotificationController {
    constructor(options) {
        this.destiny = options.destinyService;
        this.ghost = new Ghost({
            destinyService: options.destinyService
        });
        this.notifications = options.notificationService;
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * @todo before calling this, authenticate user, and check if notication sent in last week
     * @param user
     * @returns {Promise.<TResult>}
     */
    getFieldTestWeapons(user) {
        const { bungie: { accessToken: { value: accessToken }}, membershipId, membershipType } = user;

        return this.destiny.getCharacters(membershipId, membershipType)
            .then(characters => {
                const [ character ] = characters || [];

                if (!character) {
                    throw new Error('character not found');
                }

                return this.destiny.getFieldTestWeapons(character.characterBase.characterId,
                        accessToken)
                    .then(({ itemHashes = [] }) => {
                        if (itemHashes.length > 0) {
                            return this.ghost.getWorldDatabasePath()
                                .then(worldDatabasePath => this.world.open(worldDatabasePath)
                                .then(this.world.getVendorIcon(gunSmithHash))
                                .then(iconUrl => {
                                    let itemPromises = [];

                                    _.each(itemHashes, itemHash => {
                                        itemPromises.push(this.world.getItemByHash(itemHash));
                                    });

                                    return Promise.all(itemPromises)
                                        .then(items => {
                                            return this.notifications.sendMessage('The following experimental weapons need testing in the field:\n' +
                                                _.reduce(_.map(items, function (item) {
                                                    return item.itemName;
                                                }), (memo, itemName) => {
                                                    return memo + itemName + '\n';
                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                .then(message => {
                                                    return this.users.addUserMessage(user.displayName, user.membershipType, message, types.Gunsmith);
                                                });
                                        })
                                        .then(this.world.close());
                                }))
                                .catch(err => {
                                    console.log(err); // todo  log error
                                    this.world.close();
                                });
                        }
                    });
            });
    }

    createNotification(notificationType, user) {
        const subscription = user.notifications.find(n => n.type === notificationType);

        // todo check last submission?
        if (subscription && subscription.enabled) {
            if (notificationType === types.Gunsmith) {
                return this.getFieldTestWeapons(user)
                    .then(weapons => {
                        console.log(weapons);
                    });
            }
        }

        return Promise.reject('subscription not found');
    }

    create(req, res) {
        for (let header in headers) {
            if (req.headers[header] !== headers[header]) {
                return res.writeHead(403).end();
            }
        }

        const notificationType = req.params.notificationType;
        if (!notificationType) {
            return res.status(404).json('notification type not found');
        }

        const { body: phoneNumbers } = req;

        for (let phoneNumber of phoneNumbers || []) {
            this.users.getUserByPhoneNumber(phoneNumber)
                .then(user => this.createNotification(notificationType, user))
                .then(res.status(200).end())
                .catch(res.status(400).end());
        }
    }
}

module.exports = NotificationController;
