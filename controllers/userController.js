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
    PostMaster = require('../models/postMaster'),
    Tokens = require('../models/tokens'),
    Users = require('../models/user');

/**
 * @constructor
 */
var userController = function () {
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
                res.json(jSend.success());
            })
            .fail(function (err) {
                res.json(jSend.error(err.message));
            });
        //postMaster.sendRegistration(user);
        //notifications.sendRegistration(user);
    };
    return {
        register: register
    };
};

module.exports = userController;
