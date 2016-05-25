/**
 * Destiny Integration Tests
 */
'use strict';
var _ = require('underscore'),
    app = require('../app.js'),
    expect = require('chai').expect,
    req = require('supertest'),
    should = require('should'),
    superagent = require('superagent'),
    users = require('../settings/shadowUsers.json');

describe('Destiny Integration Tests', function () {
    it('Should return Xur\'s cache: all or nothing', function (done) {
        req(app).get('/api/destiny/xur/')
            .expect(200)
            .end(function (err, res) {
                should.not.exist(err);
                expect([0, 5]).to.include(JSON.parse(res.text).items.length);
                done();
            });
    });
});

var agent = superagent.agent();
describe('Destiny Integration Tests', function () {
    it('Should return current foundry items available for order', function (done) {
        this.timeout(20000);
        req(app).post('/api/users/signIn/bungie')
            .send(_.find(users, function (user) {
                return user.membershipType === 2;
            }))
            .expect(200)
            .end(function (err, res) {
                should.not.exist(err);
                expect(res.text).to.equal('Success\n');
                agent.saveCookies(res);
                var req1 = req(app).get('/api/destiny/foundryOrders/');
                agent.attachCookies(req1);
                req1.expect(200)
                    .end(function (err, res) {
                        should.not.exist(err);
                        expect([0, 5]).to.include(res.body.length);
                        done();
                    });
            });
    });
});

