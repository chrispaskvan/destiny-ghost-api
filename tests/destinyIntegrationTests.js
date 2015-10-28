/**
 * Created by chris on 10/3/15.
 */
var bodyParser = require('body-parser'),
    Destiny = require('../models/Destiny'),
    express = require('express'),
    World = require('../models/World');
var _ = require('underscore'),
    app = require('../app.js'),
    request = require('supertest'),
    should = require('should'),
    agent = request.agent(app);

describe('What is Xur selling this week?', function () {
    it('get', function (done) {
        agent.get('/api/destiny/xur')
            .expect(200)
            .end(function (err, results) {
                //console.log(results);
                done();
            })
    })
});