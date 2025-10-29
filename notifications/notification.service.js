/**
 * A module for sending SMS/MMS notifications.
 *
 * @module Notifications
 * @summary Helper functions for using the Twilio client and recording sent messages.
 * @author Chris Paskvan
 * @description Utility functions for submitting a SMS/MMS message with Twilio,
 * recording the message, and updating the message status.
 */
import configuration from '../helpers/config.js';
import { MAX_SMS_MESSAGE_LENGTH } from '../twilio/twilio.constants.js';

/**
 * Notifications Class
 */
class Notifications {
    constructor(options = {}) {
        this.client = options.client;
    }

    /**
     * @param body {string}
     * @param to {string}
     * @param mediaUrl {string}
     * @returns {*}
     */
    async sendMessage(body, to, mediaUrl, {
        claimCheckNumber,
        notificationType,
    } = {}) {
        const query = claimCheckNumber && notificationType
            ? `?claim-check-number=${claimCheckNumber}&notification-type=${notificationType}`
            : '';
        const message = {
            to,
            from: configuration.twilio.phoneNumber,
            body: body.substring(0, MAX_SMS_MESSAGE_LENGTH),
            statusCallback: `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/s${query}`,
        };

        if (mediaUrl) {
            message.mediaUrl = mediaUrl;
        }

        return await this.client.messages.create(message);
    }
}

export default Notifications;
