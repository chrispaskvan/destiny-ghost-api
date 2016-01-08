/**
 * Created by chris on 10/3/15.
 */
var app = require('../app.js'),
    should = require('should'),
    req = require('supertest'),
    superagent = require('superagent'),
    user = require('../settings/ShadowUser.json')();

var agent = superagent.agent();
var signIn = function (request, done) {
    request
        .post('/api/user')
        .send(user)
        .end(function (err, res) {
            if (err) {
                throw err;
            }
            agent.saveCookies(res);
            done(agent);
        });
};

describe('MyApp', function () {

    it('should allow access to admin when logged in', function (done) {
        var req = request.get('/admin');
        agent.attachCookies(req);
        req.expect(200, done);
    });

});
describe('What does Banshee-44 have that needs testing?', function () {
    var agent;
    before(function (done) {
        signIn(request, function (loginAgent) {
            agent = loginAgent;
            done();
        });
    });

    it('get', function (done) {
        this.timeout(0);
        req(app).get('/api/destiny/fieldTestWeapons')
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function (err, res) {
                if (err) {
                    done(err);
                }
                console.log('aaa');
                console.log(res.body);
                res.body.should.be.instanceOf(Array);
                done();

            });
        agent.attachCookies(req);
    });
});