// @ts-check
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
import { withRetry, isTransientError } from '../helpers/retry.js';
import { BRAND_PREFIX, MAX_SMS_MESSAGE_LENGTH } from '../twilio/twilio.constants.js';
import twilioRateLimiter from '../helpers/twilio-rate-limiter.js';

/**
 * Twilio's own payload and response types, rather than hand-rolled copies that
 * would drift from the SDK (the client already ships its declarations).
 * @typedef {import('twilio/lib/rest/api/v2010/account/message.js').MessageListInstanceCreateOptions} TwilioMessage
 * @typedef {import('twilio/lib/rest/api/v2010/account/message.js').MessageInstance} SentMessage
 */

/**
 * The subset of the Twilio client this service uses. Kept structural so tests can
 * substitute a stub without constructing a real client.
 * @typedef {Object} TwilioClient
 * @property {{ create: (message: TwilioMessage) => Promise<SentMessage> }} messages
 */

/**
 * Notifications Class
 */
class Notifications {
    /**
     * @param {{ client: TwilioClient, limiter?: { schedule: <T>(fn: () => Promise<T>) => Promise<T> } }} options
     */
    constructor(options) {
        this.client = options.client;
        this.limiter = options.limiter ?? twilioRateLimiter;
    }

    /**
     * Send an SMS or MMS message through Twilio, rate limited and retried.
     *
     * @param {string} body - Message body, prefixed and truncated before sending.
     * @param {string} to - Recipient phone number in E.164 format.
     * @param {string} [mediaUrl] - Attachment URL; makes this an MMS.
     * @param {{ claimCheckNumber?: string, notificationType?: string }} [options] - Correlates the delivery callback.
     * @returns {Promise<SentMessage>}
     */
    async sendMessage(body, to, mediaUrl, { claimCheckNumber, notificationType } = {}) {
        const query =
            claimCheckNumber && notificationType
                ? `?claim-check-number=${claimCheckNumber}&notification-type=${notificationType}`
                : '';
        /** @type {TwilioMessage} */
        const message = {
            to,
            from: configuration.twilio.phoneNumber,
            body: `${BRAND_PREFIX}${body}`.substring(0, MAX_SMS_MESSAGE_LENGTH),
            statusCallback: `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/s${query}`,
        };

        if (mediaUrl) {
            // The SDK types this as an array. A bare string also reaches Twilio
            // intact (serialize.map passes scalars through), and with the
            // client's `arrayFormat: 'repeat'` a single-element array encodes to
            // the identical body — so this matches the contract without
            // changing the request.
            message.mediaUrl = [mediaUrl];
        }

        return await withRetry(
            () => this.limiter.schedule(() => this.client.messages.create(message)),
            {
                shouldRetry: isTransientError,
                maxRetries: 0,
            },
        );
    }
}

export default Notifications;
