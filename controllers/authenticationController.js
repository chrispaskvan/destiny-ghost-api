/**
 * Created by chris on 11/14/15.
 */
'use strict';
var Horseman = require('node-horseman');

var fbUser = 'kyle.paskvan@apricothill.com';
var fbPass = 'kcp5823sss2';

var retryCount = 0; // we're retrying to login 2 times

var testController = function () {

    var login = function () {
        var horseman = new Horseman();
        horseman
            .open('https://www.bungie.net/en/User/SignIn/Psnid')
            .waitForSelector('#signInInput_SignInID')
            .log('typing...')
            .type('input[id="signInInput_SignInID"]', fbUser)
            .type('input[id="signInInput_Password"]', fbPass)
            .click('#signInButton')
            .log('clicked the button')
            .waitForNextPage()
            .cookies()
            .then(function(cookies){
                console.log( cookies );
                return horseman.close();
            });
    };
    return {
        login: login
    };
};

module.exports = testController;
