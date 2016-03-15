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
    Destiny = require('../models/Destiny'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    jsonpatch = require('fast-json-patch'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Postmaster = require('../models/postmaster'),
    shadowUser = require('../settings/shadowUser.psn.json'),
    Tokens = require('../models/tokens'),
    Users = require('../models/users'),
    World = require('../models/world');

/**
 * @constructor
 */
var userController = function () {
    'use strict';
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    var destiny = new Destiny(shadowUser.apiKey);
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    var ghost = new Ghost(process.env.DATABASE);
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * Post Office Model
     * @type {Postmaster|exports|module.exports}
     */
    var postmaster = new Postmaster();
    /**
     * Token Generator
     * @type {Token|exports|module.exports}
     */
    var tokens = new Tokens();
    /**
     *
     * @type {User|exports|module.exports}
     */
    var userModel = new Users(process.env.DATABASE, process.env.TWILIO);
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    var world;
    ghost.getWorldDatabasePath()
        .then(function (path) {
            world = new World(path);
        });
    /**
     * Confirm regsitration request by creating an account if appropriate.
     * @param req
     * @param res
     */
    var confirm = function (req, res) {
        var user = req.body;
        userModel.getUserToken(user.phoneNumber)
            .then(function (userToken) {
                if (((new Date() - userToken.timeStamp) / (60 * 1000)) > 10) {
                    return res.json(new jSend.error('Expired tokens.'));
                }
                if (!_.isEqual(user.tokens, userToken.tokens)) {
                    return res.json(new jSend.error('Bad tokens.'));
                }
                return userModel.getUserByPhoneNumber(user.phoneNumber)
                    .then(function (user) {
                        if (user) {
                            return res.json(new jSend.error('You are already registered. Please sign in.'));
                        }
                        return userModel.createUser(userToken)
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
     * Check if the email address is registered to a current user.
     * @param req
     * @param res
     */
    var getEmailAddress = function (req, res) {
        var emailAddress = req.params.emailAddress;
        userModel.getUserByEmailAddress(emailAddress)
            .then(function (user) {
                if (user) {
                    return res.status(204);
                }
                return res.status(404);
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
        userModel.getUserByGamerTag(gamerTag)
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
        userModel.getUserByPhoneNumber(phoneNumber)
            .then(function (user) {
                if (user) {
                    return res.status(204);
                }
                return res.status(404);
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
    var patch = function (req, res) {
        var gamerTag = req.params.gamerTag;
        userModel.getUserByGamerTag(gamerTag)
            .then(function (user) {
                var patches = req.body;
                jsonpatch.apply(user, patches);
                return userModel.updateUser(user)
                    .then(function () {
                        res.json(new jSend.success(user));
                    });
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
    var postmasterHash = 2021251983;
    /**
     *
     * @param req
     * @param res
     */
    var register = function (req, res) {
        var user = req.body;
        if (!user.gamerTag) {
            return res.status(409).json(new jSend.error('A gamer tag is required.'));
        }
        destiny.getMembershipIdFromDisplayName(user.gamerTag, user.membershipType)
            .then(function (membershipId) {
                if (!membershipId) {
                    return res.status(409).json(new jSend.error('The gamer tag' + user.gamerTag + 'is not registered with Bungie.'));
                }
                return userModel.getBlob()
                    .then(function (blob) {
                        _.extend(user, {
                            membershipId: membershipId,
                            tokens: {
                                emailAddress: blob,
                                phoneNumber: tokens.getToken()
                            }
                        });
                        return userModel.createUserToken(user)
                            .then(function () {
                                return ghost.getLastManifest()
                                    .then(function (lastManifest) {
                                        var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                                        world.open(worldPath);
                                        return world.getVendorIcon(postmasterHash)
                                            .then(function (iconUrl) {
                                                postmaster.register(user, iconUrl, '/register');
                                                notifications.sendMessage('Enter ' +
                                                    user.tokens.phoneNumber +
                                                    ' to verify your Destiny Ghost phone number.',
                                                    user.phoneNumber);
                                                res.json(new jSend.success());
                                            })
                                            .fin(function () {
                                                world.close();
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    return {
        confirm: confirm,
        getEmailAddress: getEmailAddress,
        getGamerTag: getGamerTag,
        getPhoneNumber: getPhoneNumber,
        patch: patch,
        register: register
    };
};

module.exports = userController;
