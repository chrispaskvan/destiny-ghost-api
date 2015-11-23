/**
 * Created by chris on 10/9/15.
 */
/**
 * Created by chris on 9/29/15.
 */
var _ = require('underscore'),
    destiny = require('../models/Destiny')(),
    ghost = require('../models/Ghost')(),
    notifications = require("../models/Notifications")(),
    path = require('path'),
    Q = require('q'),
    world = require('../models/World')(ghost.getWorldDatabasePath());

var notificationController = function () {
    var init = function () {
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join("./database/", path.basename(lastManifest.mobileWorldContentPaths["en"]));
                ghost.getSubscribedUsers()
                    .then(function(users) {
                        if (users && users.length > 0) {
                            destiny.getXur()
                                .then(function (items) {
                                    if (items && items.length > 0) {
                                        var itemHashes = _.map(items, function (item) {
                                            return item.item.itemHash;
                                        });
                                        world.open(worldPath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(world.getItem(itemHash));
                                        });
                                        Q.all(promises)
                                            .then(function (items) {
                                                world.close();
                                                _.each(users, function (user) {
                                                    notifications.sendSms(JSON.stringify(_.map(items, function (item) {
                                                        return item.itemName;
                                                    })), user.phoneNumber);
                                                });
                                            });
                                    }
                                })
                                .fail(function (err) {
                                    // ToDo
                                });
                        }
                    });
                })
    };
    return {
        init: init
    }
};

module.exports = notificationController;
