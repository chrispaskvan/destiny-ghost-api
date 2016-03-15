/**
 * Created by chris on 10/3/15.
 */
'use strict';
var app = require('../app.js'),
    expect = require('chai').expect,
    req = require('supertest'),
    should = require('should'),
    superagent = require('superagent'),
    user = require('../settings/shadowUser.psn.json');

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
        this.timeout(10000);
        req(app).post('/api/users/signIn/')
            .send(user)
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
                        expect([0, 5]).to.include(JSON.parse(res.text).items.length);
                        done();
                    });
            });
    });
});
