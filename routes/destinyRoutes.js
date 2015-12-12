/**
 * Created by chris on 9/25/15.
 */
'use strict';
var DestinyController = require('../controllers/destinyController'),
    express = require('express'),
    NotificationController = require('../controllers/notificationController');

var routes = function () {
    var destinyRouter = express.Router();
    var destinyController = new DestinyController();
    destinyController.init('./settings/ShadowUser.json');
    destinyRouter.route('/fieldTestWeapons/')
        .get(destinyController.getFieldTestWeapons);

    destinyRouter.route('/Xur')
        .get(destinyController.getXur);

    var notificationController = new NotificationController();
    notificationController.init('./settings/ShadowUser.json');
    return destinyRouter;
};

module.exports = routes;