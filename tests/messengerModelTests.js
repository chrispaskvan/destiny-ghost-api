/**
 * Messenger Model Tests
 */
'use strict';
var Chance = require('chance'),
    expect = require('chai').expect,
    Messenger = require('../models/Messenger');

var chance = new Chance();
var messengerModel = new Messenger();

describe('Message delivery test', function () {
    it('Should return a message Id', function (done) {
        var phoneNumber = chance.phone({
            country: 'us',
            mobile: true
        });
        var users = [];
        var i;
        for (i = 0; i < 21; i++) {
            users.push({
                firstName: chance.first(),
                emailAddress: chance.email(),
                gamerTag: 'PocketInfinity',
                lastName: chance.last(),
                phoneNumber: '+1' + phoneNumber.replace(/\D/g, ''),
                isSubscribedToXur: true,
                membershipId: '11',
                membershipType: 2,
                notifications: []
            });
        }

        messengerModel.sendMessages(users)
            .then(function () {
                setInterval(function () {
                    done();
                }, 60000);
            });
    });
});
