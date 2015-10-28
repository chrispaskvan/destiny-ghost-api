/**
 * Created by chris on 9/25/15.
 */
var _ = require('underscore'),
    express = require('express'),
    jSend = require('../models/JSend'),
    notifications = require('../models/notifications')(),
    Q = require('q'),
    storage = require('node-persist');

var routes = function () {
    var destinyRouter = express.Router();
    storage.initSync();

    var getIpAddress = function (req) {
        return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    };

    var getMembershipId = function (ipAddress) {
        return Q.Promise(function (resolve, reject) {
            var displayName = storage.getItem(ipAddress);
            if (displayName) {
                var membershipId = storage.getItem(displayName);
                if (membershipId) {
                    resolve(membershipId);
                } else {
                    destiny.getMembershipIdFromDisplayName(displayName)
                        .then(function (result) {
                            resolve(result);
                        });
                }
            } else {
                reject("Please sign in.");
            }
        });
    };

    var destinyController = require('../controllers/destinyController')();
    /**
     * Validate the Destiny Manifest.
     */
    destinyController.init();
    destinyRouter.route('/characters')
        .get(destinyController.getCharacters);

    destinyRouter.route('/characters/:characterId')
        .get(function (req, res) {
            getMembershipId(getIpAddress(req))
                .then(function (membershipId) {
                    destiny.getCharacter(membershipId, req.params.characterId)
                        .then(function (result) {
                            res.json(result);
                        });
                });
        });

    destinyRouter.route('/characters/:characterId/Activity')
        .get(function (req, res) {
            getMembershipId(getIpAddress(req))
                .then(function (membershipId) {
                    var destiny = Destiny();
                    destiny.getActivity(req.params.characterId, membershipId)
                        .then(function (result) {
                            res.json(result);
                        });
                });
        });

    destinyRouter.route('/characters/:characterId/Inventory')
        .get(function (req, res) {
            getMembershipId(getIpAddress(req))
                .then(function (membershipId) {
                    destiny.getInventory(req.params.characterId, membershipId)
                        .then(function (result) {
                            res.json(result);
                        });
                });
        });

    destinyRouter.route('/characters/:characterId/Progression')
        .get(function (req, res) {
            destiny.getMembershipIdFromDisplayName('Blue18Dragon')
                .then(function (result) {
                    destiny.getProgression(req.params.characterId, result)
                        .then(function (result) {
                            res.json(result);
                        });
                });
        });

    destinyRouter.route('/fieldTestWeapons/')
        .get(destinyController.getFieldTestWeapons);

    destinyRouter.route('/items/:itemHash')
        .get(function (req, res) {
            var itemHash = req.params.itemHash;
            if (!itemHash) {
                res.status(404).json(jSend.fail("itemHash is required."));
            }
            destiny.getItem(itemHash)
                .then(function (result) {
                    res.json(result);
                });
        });

    destinyRouter.route('/signIn/')
        .post(function (req, res) {
            var displayName = req.body.displayName;
            if (!displayName) {
                res.status(404).json(jSend.fail("displayName is required."));
            }
            storage.setItem(getIpAddress(req), displayName);
            destiny.getMembershipIdFromDisplayName(displayName)
                .then(function (result) {
                    storage.setItem(displayName, result);
                    res.json(jSend.success({membershipId: result}));
                })
                .catch(function (error) {
                    // ToDo
                });
        });

    destinyRouter.route('/signOut')
        .post(function (req, res) {
            var ipAddress = getIpAddress(req);
            var displayName = storage.getItem(ipAddress);
            if (displayName) {
                storage.removeItem(displayName);
            }
            storage.removeItem(ipAddress);
            res.json(jSend.success(null));
        });

    destinyRouter.route('/Xur')
        .get(destinyController.getXur);

    return destinyRouter;
};

module.exports = routes;