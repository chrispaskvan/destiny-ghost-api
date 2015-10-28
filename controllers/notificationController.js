/**
 * Created by chris on 10/9/15.
 */
/**
 * Created by chris on 9/29/15.
 */
var _ = require('underscore'),
    Q = require('q'),
    storage = require('node-persist');

var notificationController = function () {
    var getIpAddress = function(req) {
        return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    };
    var getMembershipId = function(ipAddress) {
        return Q.Promise(function(resolve, reject) {
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
    var _getCharacters = function (req, res) {
        destiny.getCharacters(req.membershipId)
            .then(function (result) {
                res.status(200);
                res.send(result);
            });
    };
    var getCharacters = function(req, res) {
        if (!req.membershipId) {
            getMembershipId(getIpAddress(req))
                .then(function (membershipId) {
                    req.membershipId = membershipId;
                    _getCharacters(req, res);
                })
                .fail(function (err) {
                    res.status(401).send(err);
                });
        } else {
            _getCharacters(req, res);
        }
    };
    var getFieldTestWeapons = function(req, res) {
        destiny.getFieldTestWeapons()
            .then(function (items) {
                if (items === undefined || items.length == 0) {
                    res.json(jSend.fail("Banshee-44 is the Gunsmith."));
                    return;
                }
                var itemHashes = _.map(items, function (item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItem(itemHash));
                });
                Q.all(promises)
                    .then(function (items) {
                        world.close();
//                        notifications.sendSms(JSON.stringify(_.map(items, function (item) {
//                            return item.itemName;
//                        })), "8478143292");
                        res.json(_.map(items, function (item) {
                            return item.itemName;
                        }));
                    })
                    .fail(function (err) {
                        // ToDo
                    });
            })
            .catch(function (error) {
                res.json(jSend.fail(error));
            });
    };
    var getXur = function (req, res) {
        destiny.getXur()
            .then(function (items) {
                if (items === undefined || items.length == 0) {
                    res.status(200).json(jSend.fail("Xur is not available to take your call at this time."));
                    return;
                }
                var itemHashes = _.map(items, function(item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItem(itemHash));
                });
                Q.all(promises)
                    .then(function (items) {
                        world.close();
//                        notifications.sendSms(JSON.stringify(_.map(items, function (item) {
//                            return item.itemName;
//                        })), "2312332834");
                        res.json(_.map(items, function (item) {
                            return item.itemName;
                        }));
                    })
                    .fail(function (err) {
                        // ToDo
                    });
            })
            .catch(function (error) {
                res.json(jSend.fail(error));
            });
    };
    return {
        getCharacters: getCharacters,
        getFieldTestWeapons: getFieldTestWeapons,
        getXur: getXur
    }
};

module.exports = notificationController;
