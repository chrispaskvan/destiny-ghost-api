/**
 * A module for sending SMS/MMS notifications.
 *
 * @module Notifications
 * @summary Helper functions for using the Twilio client and recording sent messages.
 * @author Chris Paskvan
 * @description Utility functions for submitting a SMS/MMS message with Twilio,
 * recording the message, and updating the message status.
 */
const settings = require('../settings/twilio.' + (process.env.NODE_ENV || 'development') + '.json');

/**
 * Notifications Class
 */
class Notifications {
    constructor(options) {
        this.client = options.client;
    }

    /**
     * @param body {string}
     * @param to {string}
     * @param mediaUrl {string}
     * @returns {*}
     */
    sendMessage(body, to, mediaUrl) {
        const message = {
            to,
            from: settings.phoneNumber,
            body,
            statusCallback: process.env.DOMAIN + '/twilio/destiny/s'
        };

        if (mediaUrl) {
            message.mediaUrl = mediaUrl;
        }

        return new Promise((resolve, reject) => {
            this.client.messages.create(message, (err, { sid, dateCreated, status }) => {
                if (err) {
                    reject(err);
                }

                resolve({ sid, dateCreated, status });
            });
        });
    }
}

module.exports = Notifications;
