'use strict';
var _ = require('underscore'),
    Chance = require('chance'),
    expect = require('chai').expect,
    fs = require('fs'),
    User = require('../models/User'),
    validator = require('validator');

var chance = new Chance();
var userModel = new User(process.env.DATABASE);

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
            lastName: chance.last(),
            phoneNumber: userModel.cleanPhoneNumber(chance.phone({
                country: 'us',
                mobile: true
            })),
            isSubscribedToXur: true,
            membershipType: 2,
            isSubscribedToBanshee44: true
        };
        userModel.getSubscribedUsers()
            .then(function (usersBefore) {
                userModel.createUser(user)
                    .then(function () {
                        userModel.getSubscribedUsers()
                            .then(function (usersAfter) {
                                expect(usersAfter.length === (usersBefore.length + 1)).to.equal(true);
                                userModel.deleteUser(user.phoneNumber);
                                done();
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
        userModel.getRandomBlob(32)
            .then(function (id) {
                expect(id.length).to.equal(64);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Get a new default 16-bit globally unique identifier', function () {
    it('Should return a random identification number', function (done) {
        userModel.getRandomBlob()
            .then(function (id) {
                expect(id.length).to.equal(32);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
