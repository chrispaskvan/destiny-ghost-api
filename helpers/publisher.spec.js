/**
 * Publish Messages
 */
'use strict';
const Chance = require('chance'),
    Publisher = require('./publisher'),
    expect = require('chai').expect;

const chance = new Chance();
const publisher = new Publisher();

describe('Message delivery test', () => {
    it('Should return true for success', function (done) {
        const numberOfUsers = 2;
        const phoneNumber = chance.phone({
            country: 'us',
            mobile: true
        });

        let users = [];
        for (let index = 0; index < numberOfUsers; index++) {
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

        let promises = [];
        users.forEach(user => {
            promises.push(publisher.sendNotification(user, 'Unknown'));
        });

        Promise.all(promises)
            .then(function (response) {
                expect(response.every(b => b === true)).to.be.true;
                done();
            });
    });
});
