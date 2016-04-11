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
var authentication = function () {
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
     * @param callback
     * @returns {*|promise}
     */
    var psnSignIn = function (userName, password, callback) {
        var deferred = Q.defer();
        var horseman = new Horseman();
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
                 * @todo Log error.
                 */
                console.log(err);
                deferred.reject(new Error('Playstation Network authentication failed for user ' + userName));
            });
        return deferred.promise.nodeify(callback);
    };
    /**
     * Sign into Xbox Live and retrieve the Bungie cookies.
     * @param userName
     * @param password
     * @param callback
     * @returns {*|promise}
     */
    var xBoxSignIn = function (userName, password, callback) {
        var deferred = Q.defer();
        var horseman = new Horseman();
        horseman.open('https://login.live.com/oauth20_authorize.srf?client_id=000000004013231D&scope=Xboxlive.signin%20Xboxlive.offline_access&response_type=code&redirect_uri=https://www.bungie.net/en/User/SignIn/Xuid&display=touch&locale=en')// jscs:ignore maximumLineLength
            .waitForSelector('#i0116')
            .type('input[id="i0116"]', userName)
            .type('input[id="i0118"]', password)
            .click('#idSIButton9')
            .waitForNextPage()
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
                 * @todo Log error.
                 */
                console.log(err);
                deferred.reject(new Error('Xbox Live authentication failed for user ' + userName));
            });
        return deferred.promise.nodeify(callback);
    };
    /**
     * Sign in for either membership type.
     * @param userName
     * @param password
     * @param membershipType
     * @param callback
     * @returns {*}
     */
    var signIn = function (userName, password, membershipType, callback) {
        var deferred = Q.defer();
        if (!userName) {
            deferred.reject(new Error('User nme is required.'));
            return deferred.promise.nodeify(callback);
        }
        if (!password) {
            deferred.reject(new Error('Password is required.'));
            return deferred.promise.nodeify(callback);
        }
        if (membershipType === membershipTypes.TigerXbox) {
            xBoxSignIn(userName, password, callback)
                .then(function (cookies) {
                    deferred.resolve(cookies);
                })
                .fail(function (err) {
                    deferred.reject(err);
                });
        } else if (membershipType === membershipTypes.TigerPsn) {
            psnSignIn(userName, password, callback)
                .then(function (cookies) {
                    deferred.resolve(cookies);
                })
                .fail(function (err) {
                    deferred.reject(err);
                });
        } else {
            deferred.reject(new Error('The membership type, ' + membershipType + ', is invalid.'));
        }
        return deferred.promise.nodeify(callback);
    };
    return {
        membershipTypes: membershipTypes,
        signIn: signIn
    };
};

module.exports = authentication;
