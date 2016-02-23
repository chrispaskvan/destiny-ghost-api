/**
 * Created by chris on 10/3/15.
 */
var app = require('../app.js'),
    expect = require('chai').expect,
    req = require('supertest'),
    should = require('should'),
    superagent = require('superagent'),
    user = require('../settings/shadowUser.psn.json');

describe('integration tests?', function () {
    it('Should ', function (done) {
        req(app).get('/api/destiny/xur/')
            .expect(200)
            .end(function (err, res) {
                should.not.exist(err);
                expect(JSON.parse(res.text).length).to.equal(5);
                done();
            });
    });
});

var agent = superagent.agent();
describe('integration tests?', function () {
    it('Should ', function (done) {
        this.timeout(0);
        req(app).post('/api/user/signIn/')
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
                        expect(JSON.parse(res.text).length).to.equal(5);
                        done();
                    });
            });
    });
});
