/**
 * A module for sending SMS/MMS notifications.
 *
 * @module Notifications
 * @summary Helper functions for using the Twilio client and recording sent messages.
 * @author Chris Paskvan
 * @description Utility functions for submitting a SMS/MMS message with Twilio,
 * recording the message, and updating the message status.
 * @requires fs
 * @requires Q
 * @requires sqlite3
 * @requires twilio
 */
var fs = require('fs'),
    Q = require('q'),
    sqlite3 = require('sqlite3'),
    twilio = require('twilio');
/**
 * @param databaseFullPath {string}
 * @param twilioSettingsFullPath {string}
 * @returns {Notifications}
 * @constructor
 */
function Notifications(textMessageClient, userService) {
    'use strict';
    this.userService = userService;
    this.textMessageClient = textMessageClient;
}
/**
 * @namespace
 * @type {{createMessage, purgeMessages, sendMessage, updateMessage}}
 */
Notifications.prototype = (function () {
    'use strict';
    /**
     * Get the message from the database with the provided Twilio SID.
     * @param sid {string}
     * @returns {*}
     * @private
     */
    var _getMessage = function (sid) {
        var deferred = Q.defer();
        this.db.each('SELECT json FROM DestinyGhostMessage WHERE json LIKE \'%"sid":"' + sid + '"%\' LIMIT 1',
            function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(JSON.parse(row.json));
                }
            });
        return deferred.promise;
    };
    /**
     * Create a new message record in the database.
     * @param message {Object}
     */
    var createMessage = function (message) {
        var sql = this.db.prepare('INSERT INTO DestinyGhostMessage VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(message));
        sql.finalize();
    };
    /**
     * Remove messages older than 2 weeks.
     */
    var purgeMessages = function () {
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        this.db.run('DELETE FROM DestinyGhostMessage WHERE (substr(id, 1, 4) || substr(id, 6, 2) ||' +
                'substr(id, 9, 2)) < \'' + cutoff.toISOString().slice(0, 10).replace(/-/g, '') + '\'',
            function (err) {
                if (err) {
                    throw err;
                }
            });
    };
    /**
     * @param body {string}
     * @param to {string}
     * @param mediaUrl {string}
     * @returns {*}
     */
    var sendMessage = function (body, to, mediaUrl) {
        var deferred = Q.defer();
        var message = {
            to: to,
            from: this.settings.phoneNumber,
            body: body,
            statusCallback: process.env.DOMAIN + '/api/twilio/destiny/s'
        };

        if (mediaUrl) {
            message.mediaUrl = mediaUrl;
        }
        this.textMessageClient.messages.create(message, function (err, response) {
            if (err) {
                return deferred.reject(err);
            }

            return deferred.resolve(response);
        });

        return deferred.promise;
    };
    /**
     * @param message {string}
     */
    var updateMessage = function (message) {
        var self = this;
        var deferred = Q.defer();
        if (!message.SmsSid) {
            deferred.reject(new Error('The message\'s unique identifier is missing.'));
            return deferred.promise;
        }
        return _getMessage(message.SmsSid)
            .then(function (originalMessage) {
                originalMessage.status = message.SmsStatus;
                self.db.run('UPDATE DestinyGhostMessage SET json = \'' +
                    JSON.stringify(originalMessage).replace(new RegExp('\'', 'g'), '\'\'') +
                    '\' WHERE json LIKE \'%"sid":"' +  originalMessage.sid + '"%\'', function (err) {
                        if (err) {
                            throw err;
                        }
                    });
            });
    };
    return {
        createMessage: createMessage,
        purgeMessages: purgeMessages,
        sendMessage: sendMessage,
        updateMessage: updateMessage
    };
}());
module.exports = Notifications;
