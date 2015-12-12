/**
 * Created by chris on 11/14/15.
 */
'use strict';
var _ = require('underscore'),
    Horseman = require('node-horseman'),
    Q = require('q');

var authenticationController = function () {
    var signIn = function (userName, password) {
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
            });
        return deferred.promise;
    };
    return {
        signIn: signIn
    };
};

module.exports = authenticationController;
