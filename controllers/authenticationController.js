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
    cookie = require('cookie'),
    Horseman = require('node-horseman'),
    Q = require('q');
/**
 * @constructor
 */
var authenticationController = function () {
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
     * Available Membership Types
     * @type {{TigerXbox: number, TigerPsn: number}}
     * @description Membership types as defined by the Bungie Destiny API
     * outlined at {@link http://bungienetplatform.wikia.com/wiki/BungieMembershipType}.
     */
    var membershipTypes = {
        TigerXbox: 1,
        TigerPsn: 2
    };
    /**
     * Sign into the Playstation Network and retrieve the Bungie cookies.
     * @param userName {string}
     * @param password {string}
     * @returns {*|promise}
     */
    var psnSignIn = function (userName, password) {
        var horseman = new Horseman();
        var deferred = Q.defer();
        horseman.open('https://www.bungie.net/en/User/SignIn/Psnid')
            .waitForSelector('#signInInput_SignInID')
            .type('input[id="signInInput_SignInID"]', userName)
            .type('input[id="signInInput_Password"]', password)
            .click('#signInButton')
            .waitForNextPage()
            .cookies()
            .then(function (cookies) {
                var bungieCookies = {
                    bungled: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungled';
                    }).value,
                    bungledid: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungledid';
                    }).value,
                    bungleatk: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungleatk';
                    }).value
                };
                horseman.close();
                deferred.resolve(bungieCookies);
            })
            .catch(function (err) {
                /**
                 * @todo Log specific error here.
                 */
                deferred.reject(new Error('Playstation Network authentication failed for user ' + userName));
            });
        return deferred.promise;
    };
    /**
     * Sign into Xbox Live and retrieve the Bungie cookies.
     * @param userName
     * @param password
     * @returns {*|promise}
     */
    var xBoxSignIn = function (userName, password) {
        var horseman = new Horseman();
        var deferred = Q.defer();
        horseman.open('https://login.live.com/oauth20_authorize.srf?client_id=000000004013231D&scope=Xboxlive.signin%20Xboxlive.offline_access&response_type=code&redirect_uri=https://www.bungie.net/en/User/SignIn/Xuid&display=touch&locale=en')
            .waitForSelector('#i0116')
            .type('input[id="i0116"]', userName)
            .type('input[id="i0118"]', password)
            .click('#idSIButton9')
            .waitForNextPage()
            .cookies()
            .then(function (cookies) {
                var bungieCookies = {
                    bungled: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungled';
                    }).value,
                    bungledid: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungledid';
                    }).value,
                    bungleatk: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungleatk';
                    }).value
                };
                horseman.close();
                deferred.resolve(bungieCookies);
            })
            .catch(function (err) {
                /**
                 * @todo Log specific error here.
                 */
                deferred.reject(new Error('Xbox Live authentication failed for user ' + userName));
            });
        return deferred.promise;
    };
    /**
     *
     * @param req
     * @param res
     */
    var signIn = function (req, res) {
        if (req.body.membershipType === membershipTypes.TigerXbox) {
            xBoxSignIn(req.body.userName, req.body.password)
                .then(function (cookies) {
                    res.header('Set-Cookie', _getCookieHeader(cookies));
                    res.end('Success\n');
                })
                .fail(function (err) {
                    res.status(401).send(err);
                });
        } else if (req.body.membershipType === membershipTypes.TigerPsn) {
            psnSignIn(req.body.userName, req.body.password)
                .then(function (cookies) {
                    res.header('Set-Cookie', _getCookieHeader(cookies));
                    res.end('Success\n');
                })
                .fail(function (err) {
                    res.status(401).send(err.message);
                });
        } else {
            res.status(401).send('Invalid membership type provided.');
        }
    };
    return {
        psnSignIn: psnSignIn,
        signIn: signIn,
        xBoxSignIn: xBoxSignIn
    };
};

module.exports = authenticationController;
