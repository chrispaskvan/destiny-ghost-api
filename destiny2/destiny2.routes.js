/**
 * Created by chris on 9/25/15.
 */
const Destiny2Controller = require('../destiny2/destiny2.controller'),
    express = require('express');
/**
 * Destiny Routes
 * @param authenticateUser
 * @param destinyService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
var routes = function (destiny2Service) {
    'use strict';
    var destiny2Router = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    var destiny2Controller = new Destiny2Controller({ destiny2Service });
    /**
     * Routes
     */
    destiny2Router.route('/manifest')
        .get(function (req, res) {
            destiny2Controller.getManifest(req, res);
        });
    destiny2Router.route('/manifest')
        .put(function (req, res) {
            destiny2Controller.upsertManifest(req, res);
        });
    return destiny2Router;
};

module.exports = routes;
