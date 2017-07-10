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
    Authentication = require('../models/authentication'),
    Destiny = require('../destiny/destiny.model'),
    cookie = require('cookie'),
    Users = require('../users/user.service');
/**
 * @constructor
 */
function AuthenticationController() {
    'use strict';
    /**
     * Authentication Model
     * @type {Authentication|exports|module.exports}
     */
    this.authentication = new Authentication();
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    this.destiny = new Destiny();
    /**
     *
     * @type {User|exports|module.exports}
     */
    this.users = new Users(undefined, process.env.TWILIO);
}
AuthenticationController.prototype = (function () {
    'use strict';
    /**
     * @function
     * @returns {Array}
     * @private
     * @description Returns the cookie header string comprised of all Bungie cookies
     * required in certain web API requests.
     */
    var _getCookieHeader = function (bungieCookies) {
        var cookies = [];
        _.each(_.keys(bungieCookies), function (cookieName) {
            cookies.push(cookie.serialize(cookieName, bungieCookies[cookieName], {
                expires: new Date(Date.now() + 12096e5),
                path: '/'
            }));
        });
        return cookies;
    };
    /**
     *
     * @param req
     * @param res
     */
    var signIn = function (req, res) {
        var self = this;
        var code = req.query.code;
        var sessionId = req.query.state;
        var io = req.app.get('io');
        var socketId = _.find(_.keys(io.sockets.sockets), function (key) {
            return io.sockets.sockets[key].client.request.sessionID === sessionId;
        });
        if (socketId) {
            io.sockets.sockets[socketId].emit('logged_in', 'test111111');
        }

        return this.destiny.getAccessTokenFromCode(code)
            .then(function (bungie) {
                return self.destiny.getCurrentUser(bungie.accessToken.value)
                    .then(function (user) {
                        if (user) {
                            _.extend(user, {
                                bungie: bungie
                            });
                            self.users.createAnonymousUser(user)
                                .then(function () {
                                    res.redirect('http://localhost:1100');
                                });
                        }
                    });
            });
    };
    return {
        signIn: signIn
    };
}());
module.exports = AuthenticationController;
