/**
 * Created by chris on 9/27/15.
 */
var nconf = require("nconf");
nconf.file("./settings/twilio.json");
var accountSid = nconf.get("accountSid"),
    authToken = nconf.get("authToken");

var client = require('twilio')(accountSid, authToken);

var Notifications = function () {
    var sendSms = function (body, to) {
        client.sendSms({
            to: to,
            from: '9708002310',
            body: body,
            statusCallback: 'http://a20adc9c.ngrok.io/api/twilio/test2'
        }, function (error, message) {
            if (!error) {
                console.log('Success! The SID for this SMS message is:');
                console.log(message.sid);
                console.log('Message sent on:');
                console.log(message.dateCreated);
            } else {
                console.log('Oops! There was an error.');
            }
        });
    };

    return {
        sendSms: sendSms
    }
};

module.exports = Notifications;
