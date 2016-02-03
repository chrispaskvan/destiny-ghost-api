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
    jSend = require('../models/jsend'),
    Notifications = require('../models/notifications'),
    PostMaster = require('../models/postMaster'),
    Tokens = require('../models/tokens'),
    Users = require('../models/user');

/**
 * @constructor
 */
var userController = function () {
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * Post Office Model
     * @type {PostMaster|exports|module.exports}
     */
    var postMaster = new PostMaster();
    /**
     * Token Generator
     * @type {Token|exports|module.exports}
     */
    var tokens = new Tokens();
    /**
     *
     * @type {User|exports|module.exports}
     */
    var users = new Users(process.env.DATABASE, process.env.TWILIO);
    /**
     *
     * @param req
     * @param res
     */
    var confirm = function (req, res) {
        var user = req.body;
        users.getUserToken(user.phoneNumber)
            .then(function (userToken) {
                if (!_.isEqual(user.tokens, userToken.tokens)) {
                    return res.json(new jSend.error('Bad tokens.'));
                }
                return users.getUserByPhoneNumber(user.phoneNumber)
                    .then(function (user) {
                        if (user) {
                            return res.json(new jSend.error('You are already registered. Please sign in.'));
                        }
                        return users.createUser(user)
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
     *
     * @param req
     * @param res
     */
    var register = function (req, res) {
        var user = req.body;
        _.extend(user, {
            tokens: {
                emailAddress: tokens.getToken(),
                phoneNumber: tokens.getToken()
            }
        });
        users.createUserToken(user)
            .then(function () {
                postMaster.register(user);
                notifications.sendMessage('Enter ' +
                    user.tokens.phoneNumber +
                    ' to verify your Destiny Ghost phone number.',
                    user.phoneNumber);
                res.json(new jSend.success());
            })
            .fail(function (err) {
                res.json(new jSend.error(err.message));
            });
    };
    return {
        confirm: confirm,
        register: register
    };
};

module.exports = userController;
