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
'use strict';
var fs = require('fs'),
    Q = require('q'),
    sqlite3 = require('sqlite3'),
    twilio = require('twilio');
/**
 * @param databaseFullPath {string}
 * @param twilioSettingsFullPath {string}
 * @returns {{createMessage: createMessage, purgeMessages: purgeMessages,
  * sendMessage: sendMessage, updateMessage: updateMessage}}
 * @constructor
 */
var Notifications = function (databaseFullPath, twilioSettingsFullPath) {
    /**
     * @member - Full path of the local database.
     * @type {*|string}
     * @public
     */
    this.databaseFullPath = databaseFullPath || './databases/ghost.db';
    if (!fs.existsSync(databaseFullPath)) {
        console.log('Creating database file.');
        fs.openSync(this.databaseFullPath, 'w');
    }
    /**
     * @type {sqlite3.Database}
     */
    var db = new sqlite3.Database(this.databaseFullPath);
    db.configure('busyTimeout', 2000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostMessage(id TEXT, json BLOB)');
    });
    /**
     * Get the message from the database with the provided Twilio SID.
     * @param sid {string}
     * @returns {*}
     * @private
     */
    var _getMessage = function (sid) {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyGhostMessage WHERE json LIKE \'%"sid":"' + sid + '"%\' LIMIT 1',
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
        var sql = db.prepare('INSERT INTO DestinyGhostMessage VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(message));
        sql.finalize();
    };
    /**
     * Remove messages older than 2 weeks.
     */
    var purgeMessages = function () {
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        db.run('DELETE FROM DestinyGhostMessage WHERE (substr(id, 1, 4) || substr(id, 6, 2) || substr(id, 9, 2)) < \'' +
                cutoff.toISOString().slice(0, 10).replace(/-/g, '') + '\'',
            function (err) {
                if (err) {
                    throw err;
                }
            });
    };
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.production.json'));
    /**
     * Twilio Client
     * @type {twilio}
     */
    var twilioClient = twilio(settings.accountSid, settings.authToken);
    /**
     * @param body {string}
     * @param to {string}
     * @param mediaUrl {string}
     * @returns {*}
     */
    var sendMessage = function (body, to, mediaUrl) {
        var deferred = Q.defer();
        var m = {
            to: to,
            from: settings.phoneNumber,
            body: body,
            statusCallback: process.env.DOMAIN + '/api/twilio/destiny/s'
        };
        if (mediaUrl) {
            m.mediaUrl = mediaUrl;
        }
        twilioClient.messages.create(m, function (err, message) {
            if (!err) {
                createMessage(message);
                deferred.resolve(message);
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise;
    };
    /**
     * @param message {string}
     */
    var updateMessage = function (message) {
        if (!message.SmsSid) {
            throw new Error('The message\'s unique identifier is missing.');
        }
        _getMessage(message.SmsSid)
            .then(function (originalMessage) {
                originalMessage.status = message.SmsStatus;
                db.run('UPDATE DestinyGhostMessage SET json = \'' +
                    JSON.stringify(originalMessage).replace('\'', '\'\'') +
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
};

module.exports = Notifications;
