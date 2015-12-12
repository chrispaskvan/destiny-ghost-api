/**
 * Created by chris on 9/27/15.
 */
'use strict';
var fs = require('fs'),
    sqlite3 = require('sqlite3'),
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
    var createMessage = function (message) {
        var sql = db.prepare('INSERT INTO DestinyGhostMessage VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(message));
        sql.finalize();
    };
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.json'));
    var twilioClient = twilio(settings.accountSid, settings.authToken);
    var sendMessage = function (body, to) {
        twilioClient.sendSms({
            to: to,
            from: settings.phoneNumber,
            body: body,
            statusCallback: process.env.DOMAIN + '/api/twilio/destiny/s'
        }, function (error, message) {
            if (!error) {
                createMessage(message);
            } else {
                console.log(error.toString());
            }
        });
    };
    return {
        createMessage: createMessage,
        sendMessage: sendMessage
    };
};

module.exports = Notifications;
