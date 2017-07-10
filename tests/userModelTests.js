/**
 * User Model Tests
 */
'use strict';
var Chance = require('chance'),
    expect = require('chai').expect,
    Users = require('../models/users'),
    validator = require('validator');

var chance = new Chance();
var userModel = new Users(process.env.DATABASE, process.env.TWILIO);

describe('Format a phone number', function () {
    it('Should return a properly formatted phone number', function (done) {
        var phoneNumber = chance.phone({ country: 'us', mobile: true });
        var cleanPhoneNumber = userModel.cleanPhoneNumber(phoneNumber);
        expect(validator.isMobilePhone(cleanPhoneNumber, 'en-US')).to.equal(true);
        done();
    });
});
describe('Get the carrier type of a phone number', function () {
    it('Should return a type of mobile', function (done) {
        var phoneNumber = chance.phone({ country: 'us', mobile: true });
        var cleanPhoneNumber = userModel.cleanPhoneNumber(phoneNumber);
        userModel.getPhoneNumberType(cleanPhoneNumber)
            .then(function (phoneNumberType) {
                expect(phoneNumberType.type).to.equal('mobile');
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Create a new user', function () {
    it('Should add a new valid user', function (done) {
        var user = {
            firstName: chance.first(),
            emailAddress: chance.email(),
            gamerTag: 'PocketInfinity',
            lastName: chance.last(),
            phoneNumber: userModel.cleanPhoneNumber(chance.phone({
                country: 'us',
                mobile: true
            })),
            isSubscribedToXur: true,
            membershipId: '11',
            membershipType: 2,
            notifications: []
        };
        userModel.getSubscribedUsers()
            .then(function (subscribedUsersBefore) {
                return userModel.createUser(user)
                    .then(function () {
                        return userModel.getRegisteredUsers()
                            .then(function (registeredUsersAfter) {
                                expect(registeredUsersAfter.length ===
                                    (subscribedUsersBefore.length + 1)).to.equal(true);
                                return userModel.getSubscribedUsers()
                                    .then(function (subscribedUsersAfter) {
                                        expect(subscribedUsersAfter.length ===
                                            subscribedUsersBefore.length).to.equal(true);
                                        userModel.deleteUser(user.phoneNumber);
                                        done();
                                    });
                            });
                    });
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Get a new 32-bit globally unique identifier', function () {
    it('Should return a random identification number', function (done) {
        userModel.getBlob(32)
            .then(function (id) {
                expect(id.length).to.equal(64);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Get a new 16-bit globally unique identifier', function () {
    it('Should return a random identification number', function (done) {
        userModel.getBlob()
            .then(function (id) {
                expect(id.length).to.equal(32);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
