/**
 * Created by chris on 9/27/15.
 */
'use strict';
var fs = require('fs'),
    sqlite3 = require('sqlite3'),
    Q = require('q'),
    twilio = require('twilio');

var Notifications = function (databaseFullPath, twilioSettingsFullPath) {
    databaseFullPath = databaseFullPath || './database/ghost.db';
    if (!fs.existsSync(databaseFullPath)) {
        console.log('Creating database file.');
        fs.openSync(databaseFullPath, 'w');
    }
    var db = new sqlite3.Database(databaseFullPath);
    db.configure('busyTimeout', 2000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostMessage(id TEXT, json BLOB)');
    });
    var _getMessage = function (sid) {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyGhostMessage WHERE json LIKE \'%"sid":"' + sid + '"%\' LIMIT 1', function (err, row) {
            if (err) {
                throw err;
            }
            deferred.resolve(JSON.parse(row.json));
        }, function (err, rows) {
            if (err) {
                throw err;
            }
            if (rows === 0) {
                deferred.resolve();
            }
        });
        return deferred.promise;
    };
    var createMessage = function (message) {
        var sql = db.prepare('INSERT INTO DestinyGhostMessage VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(message));
        sql.finalize();
    };
    var purgeMessages = function () {
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        db.run('DELETE FROM DestinyGhostMessage WHERE (substr(id, 1, 4) || substr(id, 6, 2) || substr(id, 9, 2)) < \'' + cutoff.toISOString().slice(0, 10).replace(/-/g, '') + '\'',
            function (err) {
                if (err) {
                    throw err;
                }
            });
    };
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.json'));
    var twilioClient = twilio(settings.accountSid, settings.authToken);
    var sendMessage = function (body, to) {
        var deferred = Q.defer();
        twilioClient.sendSms({
            to: to,
            from: settings.phoneNumber,
            body: body,
            statusCallback: process.env.DOMAIN + '/api/twilio/destiny/s'
        }, function (err, message) {
            if (!err) {
                createMessage(message);
                deferred.resolve(message);
            } else {
                throw err;
            }
        });
        return deferred.promise;
    };
    var updateMessage = function (message) {
        if (!message.SmsSid) {
            throw new Error('The message\'s unique identifier is missing.');
        }
        _getMessage(message.SmsSid)
            .then(function (originalMessage) {
                originalMessage.status = message.SmsStatus;
                db.run('UPDATE DestinyGhostMessage SET json = \'' + JSON.stringify(originalMessage).replace('\'', '\'\'') + '\' WHERE json LIKE \'%"sid":"' + originalMessage.sid + '"%\'',
                    function (err) {
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
