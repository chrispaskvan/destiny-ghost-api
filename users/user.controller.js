/**
 * A module for managing user authentication.
 *
 * @module Authentication Controller
 * @summary Create a Short URL
 * @author Chris Paskvan
 * @requires _
 * @requires Horseman
 * @requires Q
 */
'use strict';
var _ = require('underscore'),
    crypto = require('crypto'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    jsonpatch = require('fast-json-patch'),
    Notifications = require('../models/notifications'),
    Q = require('q'),
    path = require('path'),
    Postmaster = require('../helpers/postmaster'),
    tokens = require('../helpers/tokens'),
    World = require('../models/world');
/**
 * Time to Live for Tokens
 * @type {number}
 */
var ttl = 300;
/**
 * Get the phone number format into the Twilio standard.
 * @param phoneNumber
 * @returns {string}
 * @private
 */
function cleanPhoneNumber(phoneNumber) {
    var cleaned = phoneNumber.replace(/\D/g, '');
    return '+1' + cleaned;
}
/**
 *
 */
function getEpoch() {
    return Math.floor((new Date()).getTime() / 1000);
}
/**
 * @constructor
 */
function UserController(destinyService, userService) {
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    this.destiny = destinyService;
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    this.ghost = new Ghost(process.env.DATABASE);
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    this.notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * Post Office Model
     * @type {Postmaster|exports|module.exports}
     */
    this.postmaster = new Postmaster();
    /**
     *
     * @type {User|exports|module.exports}
     */
    this.users = userService;
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    this.world = new World();
}
/**
 * @namespace
 * @type {{confirm, enter, getEmailAddress, getGamerTag, getPhoneNumber, getUserByEmailAddressToken,
 * knock, register, update}}
 */
UserController.prototype = (function () {
    /**
     * Confirm regsitration request by creating an account if appropriate.
     * @param req
     * @param res
     */
    var join = function (req, res) {
        var self = this;
        var user = req.body;

        this.users.getUserByEmailAddressToken(user.tokens.emailAddress)
            .then(function (user1) {
                if (!user1 ||
                        getEpoch() > (user1.membership.tokens.timeStamp + ttl) ||
                        !_.isEqual(user.tokens.phoneNumber, user1.membership.tokens.code)) {
                    return res.status(498).end();
                }

                user1.dateRegistered = new Date().toISOString();

                return self.users.updateUser(user1)
                    .then(function () {
                        req.session.displayName = user1.displayName;
                        req.session.membershipType = user1.membershipType;
                        res.status(200).end();
                    });
            })
            .fail(function (err) {
                res.status(500).send(err.message);
            });
    };
    /**
     *
     * @param req
     * @param res
     */
    var getCurrentUser = function (req, res) {
        var self = this;

        if (!req.session.displayName) {
            return res.status(401).end();
        }
        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (user) {
                if (user) {
                    return self.destiny.getCurrentUser(user.bungie.accessToken.value)
                        .then(function (user) {
                            if (user) {
                                return res.status(200)
                                    .json({ displayName: user.displayName })
                                    .end();
                            }

                            return res.status(401).end();
                        })
                        .fail(function (err) {
                            return self.destiny.getAccessTokenFromRefreshToken(user.bungie.refreshToken.value)
                                .then(function (bungie) {
                                    _.extend(user, {
                                        bungie: bungie
                                    });
                                    self.users.updateAnonymousUser(user);
                                    return res.status(200)
                                        .json({ displayName: user.displayName })
                                        .end();
                                });
                        });
                } else {
                    return res.status(401).end();
                }
            })
            .fail(function (err) {
                return res.status(500).end();
            });
    };
    /**
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    var getUserByEmailAddress = function (req, res) {
        var emailAddress = req.params.emailAddress;
        if (!emailAddress) {
            return res.status(409).json(new jSend.error('An email address is required.'));
        }
        this.users.getUserByEmailAddress(emailAddress)
            .then(function (user) {
                if (user) {
                    return res.status(204).end();
                }
                return res.status(404).end();
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    /**
     * Check if the phone number is registered to a current user.
     * @param req
     * @param res
     */
    var getUserByPhoneNumber = function (req, res) {
        var phoneNumber = req.params.phoneNumber;
        if (!phoneNumber) {
            return res.status(409).json(new jSend.error('A phone number is required.'));
        }
        this.users.getUserByPhoneNumber(phoneNumber)
            .then(function (user) {
                if (user) {
                    return res.status(204).end();
                }
                return res.status(404).end();
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    /**
     * @constant
     * @type {string}
     * @description Postmaster Vendor Number
     */
    var postmasterHash = '2021251983';
    /**
     * User initial registration request.
     * @param req
     * @param res
     */
    var apply = function (req, res) {
        var self = this;
        var promises = [];

        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (user) {
                if (!user) {
                    return res.status(401).end();
                }

                _.extend(user, _.extend(req.body, {
                    membership: {
                        tokens: {
                            blob: tokens.getBlob(),
                            code: tokens.getCode(),
                            timeStamp: getEpoch()
                        }
                    }
                }));
                user.phoneNumber = cleanPhoneNumber(user.phoneNumber);

                promises.push(self.users.getUserByEmailAddress(user.emailAddress));
                promises.push(self.users.getUserByPhoneNumber(user.phoneNumber));

                return Q.all(promises)
                    .then(function (users) {
                        if (_.reject(users, function (user) {
                                return user === undefined || user.dateRegistered === undefined;
                            }).length) {

                            return res.status(409).end();
                        }

                        return self.ghost.getLastManifest()
                            .then(function (lastManifest) {
                                var worldPath = path.join('./databases/',
                                    path.basename(lastManifest.mobileWorldContentPaths.en));
                                self.world.open(worldPath);
                                return self.world.getVendorIcon(postmasterHash)
                                    .then(function (iconUrl) {
                                        return self.notifications.sendMessage('Enter ' +
                                                user.membership.tokens.code + ' to verify your phone number.',
                                                user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                            .then(function (message) {
                                                return [message, self.postmaster.register(user, iconUrl, '/register')];
                                            })
                                            .spread(function (message, postmark) {
                                                user.membership.message = message;
                                                user.membership.postmark = postmark;

                                                return self.users.updateUser(user);
                                            })
                                            .fin(function () {
                                                res.status(200).end();
                                            });
                                    })
                                    .fin(function () {
                                        self.world.close();
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.status(422).send(err.message);
            });
    };
    /**
     * Sign In with Bungie and PSN/XBox Live
     * @param req
     * @param res
     */
    var signIn = function (req, res) {
        var self = this;
        var code = req.query.code;
        var state = req.query.state;

        if (req.session.displayName) {
            return res.status(200)
                .json({ displayName: req.session.displayName })
                .end();
        }
        if (req.session.state !== state) {
            return res.sendStatus(403);
        }
        return this.destiny.getAccessTokenFromCode(code)
            .then(function (bungie) {
                return self.destiny.getCurrentUser(bungie.accessToken.value)
                    .then(function (user) {
                        if (!user) {
                            return res.status(451).end(); // Todo: Document
                        }
                        if (!user.membershipId) {
                            return res.status(404).end();
                        }
                        _.extend(user, {
                            bungie: bungie
                        });
                        self.users.createAnonymousUser(user)
                            .then(function () {
                                req.session.displayName = user.displayName;
                                req.session.membershipType = user.membershipType;
                                req.session.state = undefined;

                                return res.status(200)
                                    .json({ displayName: user.displayName })
                                    .end();
                            });
                    });
            })
            .fail(function (err) {
                return res.status(401).send(err.message);
            });
    };
    /**
     * Sign In with Bungie and PSN/XBox Live
     * @param req
     * @param res
     */
    var signOut = function (req, res) {
        req.session.destroy();
        res.status(401).end();
    };
    /**
     * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
     * @param req
     * @param res
     * @returns {*}
     * @todo Deny operations on immutable properties.
     */
    var update = function (req, res) {
        var self = this;
        var membershipId = req.params.membershipId;
        if (!membershipId) {
            return res.status(409).json(new jSend.error('Membership is required.'));
        }
        this.users.getUserByMembershipId(membershipId)
            .then(function (user) {
                if (!user) {
                    return res.status(404).json(new jSend.fail('User not found.'));
                }
                var patches = req.body;
                jsonpatch.apply(user, patches);
                return self.users.updateUser(user)
                    .then(function () {
                        res.json(new jSend.success(user));
                    });
            })
            .fail(function (err) {
                return res.status(500).json(new jSend.error(err.message));
            });
    };
    return {
        apply: apply,
        getCurrentUser: getCurrentUser,
        getUserByEmailAddress: getUserByEmailAddress,
        getUserByPhoneNumber: getUserByPhoneNumber,
        join: join,
        signIn: signIn,
        signOut: signOut,
        update: update
    };
}());
module.exports = UserController;
