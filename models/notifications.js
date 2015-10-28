/**
 * Created by chris on 9/27/15.
 */
var client = require('twilio')('AC4f1f6a7f3cc91dcc5ac652dbe5561ab7', '1c4022f7e564e7c66b352db1065a2d25');

var notifications = function () {
    var sendSms = function (body, to) {
        client.sendSms({
            to: to,
            from:'9708002310',
            body: body,
            statusCallback: 'http://a20adc9c.ngrok.io/api/twilio/test2'
        }, function(error, message) {
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

module.exports = notifications;
