/**
 * Created by chris on 9/29/15.
 */
var _ = require('underscore'),
    assert = require('assert'),
    should = require('should'),
    sinon = require('sinon');

var chai = require('chai'),
    sinonChai = require("sinon-chai");
var expect = chai.expect;

describe('Destiny Controller Tests', function () {
    describe('Get', function () {
        it('should return valid membershipId', function () {
            var req = {
                membershipId: "4611686018433851972"
            }
            var res = {
                status: sinon.spy(),
                json: sinon.spy(),
                send: sinon.spy()
            }
            var destiny = require('../models/Destiny')();
            var world = require('../models/World')();
            var destinyController = require('../controllers/destinyController')(destiny, world);
            destinyController.getCharacters(req, res);
        })
    });
    describe("What's available for testing from the Gun Smith?", function () {
        it('should return valid membershipId', function () {
            var fieldTestWeapons = ["Häkke Test-A","SUROS TSA-10","Omolon Test FR1","Häkke Test-A","Häkke Test-A"];
            var req = {
                membershipId: "4611686018433851972"
            }
            var res = {
                status: sinon.spy(),
                send: sinon.spy()
            }
            var res = {
                status: sinon.spy(),
                json: sinon.spy(),
                send: sinon.spy()
            }
            var destiny = require('../models/Destiny')();
            var world = require('../models/World')();
            var destinyController = require('../controllers/destinyController')(destiny, world);
            destinyController.getFieldTestWeapons(req, res);
            res.json.returned(sinon.match.same(fieldTestWeapons));
            //done();
        })
    })
});
