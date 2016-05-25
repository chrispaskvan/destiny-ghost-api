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
var _ = require('underscore'),
    Destiny = require('../models/destiny'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    jsonpatch = require('fast-json-patch'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Postmaster = require('../models/postmaster'),
    Tokens = require('../models/tokens'),
    Users = require('../models/users'),
    World = require('../models/world');

/**
 * @constructor
 */
function UserController() {
    'use strict';
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    this.destiny = new Destiny();
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
     * Token Generator
     * @type {Token|exports|module.exports}
     */
    this.tokens = new Tokens();
    /**
     *
     * @type {User|exports|module.exports}
     */
    this.users = new Users(process.env.DATABASE, process.env.TWILIO);
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
    'use strict';
    /**
     * Confirm regsitration request by creating an account if appropriate.
     * @param req
     * @param res
     */
    var confirm = function (req, res) {
        var self = this;
        var user = req.body;
        this.users.getUserTokenByPhoneNumber(user.phoneNumber)
            .then(function (userToken) {
                if (((new Date() - userToken.timeStamp) / (60 * 1000)) > 10) {
                    return res.json(new jSend.error('Expired tokens.'));
                }
                if (!_.isEqual(user.tokens, userToken.tokens)) {
                    return res.json(new jSend.error('Bad tokens.'));
                }
                return self.users.getUserByPhoneNumber(user.phoneNumber)
                    .then(function (registeredUser) {
                        if (registeredUser) {
                            return res.json(new jSend.error('You are already registered. Please sign in.'));
                        }
                        return self.users.createUser(
                            _.extend(_.omit(userToken, ['notifications', 'timeStamp', 'tokens']),
                                { notifications: user.notifications })
                        )
                            .then(function () {
                                return res.json(new jSend.success());
                            });
                    });
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    /**
     * User requests to sign in with an authentication token.
     * @param req
     * @param res
     * @returns {*}
     */
    var enter = function (req, res) {
        var gamerTag = req.body.gamerTag;
        var membershipType = req.body.membershipType;
        var phoneNumberToken = req.body.tokens ? req.body.tokens.phoneNumber : undefined;
        if (!gamerTag || !membershipType || !phoneNumberToken) {
            return res.status(409).json(new jSend.error('A gamer tag is required.'));
        }
        return this.users.getUserByPhoneNumberToken(phoneNumberToken)
            .then(function (user) {
                if (!user) {
                    return res.status(404).end();
                }

            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    /**
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    var getEmailAddress = function (req, res) {
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
     * Check if the gamer tag is registered to a current user.
     * @param req
     * @param res
     */
    var getGamerTag = function (req, res) {
        var gamerTag = req.params.gamerTag;
        var membershipType = req.params.membershipType;
        if (!gamerTag || !membershipType) {
            return res.status(409).json(new jSend.error('A gamer tag is required.'));
        }
        this.users.getUserByGamerTag(gamerTag, membershipType)
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
    var getPhoneNumber = function (req, res) {
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
     * Return the user token matching the email address hash key.
     * @param req
     * @param res
     * @returns {*}
     */
    var getUserByEmailAddressToken = function (req, res) {
        var emailAddressToken = req.params.emailAddressToken;
        if (!emailAddressToken) {
            return res.status(404).end();
        }
        this.users.getUserTokenByEmailAddressToken(emailAddressToken)
            .then(function (user) {
                res.josn(new jSend.success(_.omit(user, 'tokens')));
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
     * User requests an authentication code.
     * @param req
     * @param res
     * @returns {*}
     */
    var knock = function (req, res) {
        var self = this;
        var gamerTag = req.body.gamerTag;
        var membershipType = req.body.membershipType;
        if (!gamerTag || !membershipType) {
            return res.status(409).json(new jSend.error('A gamer tag is required.'));
        }
        this.destiny.getMembershipIdFromDisplayName(gamerTag, membershipType)
            .then(function (membershipId) {
                if (!membershipId) {
                    return res.status(409).json(new jSend.error('The gamer tag' + gamerTag +
                        'is not registered with Bungie.'));
                }
                return self.users.getUserByGamerTag(gamerTag, membershipType)
                    .then(function (user) {
                        if (!user) {
                            return res.status(404).json(new jSend.fail('That gamer tag is not registered.'));
                        }
                        _.extend(user, {
                            tokens: {
                                emailAddress: undefined,
                                phoneNumber: self.tokens.getToken()
                            }
                        });
                        return self.users.createUserToken(user)
                            .then(function () {
                                return self.ghost.getLastManifest()
                                    .then(function (lastManifest) {
                                        var worldPath = path.join('./databases/',
                                            path.basename(lastManifest.mobileWorldContentPaths.en));
                                        self.world.open(worldPath);
                                        return self.world.getVendorIcon(postmasterHash)
                                            .then(function (iconUrl) {
                                                self.notifications.sendMessage('Enter ' +
                                                    user.tokens.phoneNumber +
                                                    ' to verify your Destiny Ghost phone number.',
                                                    user.phoneNumber, user.type === 'mobile' ? iconUrl : '');
                                                res.json(new jSend.success());
                                            })
                                            .fin(function () {
                                                self.world.close();
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    /**
     * User initial registration request.
     * @param req
     * @param res
     */
    var register = function (req, res) {
        var self = this;
        var user = req.body;
        if (!user.gamerTag || !user.membershipType) {
            return res.status(409).json(new jSend.error('A gamer tag is required.'));
        }
        this.destiny.getMembershipIdFromDisplayName(user.gamerTag, user.membershipType)
            .then(function (membershipId) {
                if (!membershipId) {
                    return res.status(409).json(new jSend.error('The gamer tag' + user.gamerTag +
                        'is not registered with Bungie.'));
                }
                return self.users.getBlob()
                    .then(function (blob) {
                        _.extend(user, {
                            membershipId: membershipId,
                            tokens: {
                                emailAddress: blob,
                                phoneNumber: self.tokens.getToken()
                            }
                        });
                        return self.users.createUserToken(user)
                            .then(function () {
                                return self.ghost.getLastManifest()
                                    .then(function (lastManifest) {
                                        var worldPath = path.join('./databases/',
                                            path.basename(lastManifest.mobileWorldContentPaths.en));
                                        self.world.open(worldPath);
                                        return self.world.getVendorIcon(postmasterHash)
                                            .then(function (iconUrl) {
                                                self.postmaster.register(user, iconUrl, '/register');
                                                self.notifications.sendMessage('Enter ' +
                                                    user.tokens.phoneNumber +
                                                    ' to verify your Destiny Ghost phone number.',
                                                    user.phoneNumber, user.type === 'mobile' ? iconUrl : '');
                                                res.json(new jSend.success());
                                            })
                                            .fin(function () {
                                                self.world.close();
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
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
                res.json(new jSend.error(err.message));
            });
    };
    return {
        confirm: confirm,
        enter: enter,
        getEmailAddress: getEmailAddress,
        getGamerTag: getGamerTag,
        getPhoneNumber: getPhoneNumber,
        getUserByEmailAddressToken: getUserByEmailAddressToken,
        knock: knock,
        register: register,
        update: update
    };
}());
module.exports = UserController;
