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
    Authentication = require('../models/authentication'),
    cookie = require('cookie');
/**
 * @constructor
 */
var authenticationController = function () {
    /**
     * Authentication Model
     * @type {Authentication|exports|module.exports}
     */
    var authentication = new Authentication();
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
        var userName = req.body.userName;
        var password = req.body.password;
        var membershipType = req.body.membershipType;
        authentication.signIn(userName, password, membershipType)
            .then(function (cookies) {
                res.header('Set-Cookie', _getCookieHeader(cookies));
                res.end('Success\n');
            })
            .fail(function (err) {
                res.status(401).send(err.message);
            });
    };
    return {
        signIn: signIn
    };
};

module.exports = authenticationController;
