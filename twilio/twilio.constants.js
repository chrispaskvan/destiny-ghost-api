/**
 * Twilio Constants
 */

/**
 * @constant
 * @type {number}
 * {@link https://www.twilio.com/docs/glossary/what-sms-character-limit}
 * @description Maximum number of characters to include in an SMS message.
 */
export const MAX_SMS_MESSAGE_LENGTH = 1600;

/**
 * @constant
 * @description Brand name prefix required by carrier compliance on every outbound
 * SMS/MMS message. Applied centrally where messages are sent, not per message.
 */
export const BRAND_PREFIX = 'Destiny-Ghost: ';

/**
 * @constant
 * @description Inbound keywords that opt a phone number out of further messages.
 */
export const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

/**
 * @constant
 * @description Inbound keywords requesting help/support information.
 */
export const HELP_KEYWORDS = new Set(['help', 'info']);

/**
 * @constant
 * @description Inbound keywords that re-subscribe a previously opted-out number.
 */
export const START_KEYWORDS = new Set(['start', 'unstop', 'yes']);

/**
 * @constant
 * @description Reply sent after a STOP keyword is received.
 */
export const STOP_REPLY =
    "You're unsubscribed. No further messages will be sent. Reply START to re-subscribe.";

/**
 * @constant
 * @description Reply sent after a HELP keyword is received.
 */
export const HELP_REPLY =
    'SMS alerts, up to 10 msgs/week. Msg&data rates may apply. Reply STOP to cancel. Help: banshee-44@destiny-ghost.com';

/**
 * @constant
 * @description Reply sent after a START keyword is received.
 */
export const START_REPLY =
    "You're re-subscribed. Up to 10 msgs/week. Msg&data rates may apply. Reply HELP for help, STOP to cancel.";

/**
 * @constant
 * @description Reply acknowledging receipt of an MMS image queued for analysis.
 */
export const MEDIA_RECEIVED_REPLY = 'Got it. Your image is being analyzed.';

/**
 * @constant
 * @description Reply sent when an MMS attachment is not an image.
 */
export const MEDIA_UNSUPPORTED_REPLY = 'Sorry, I can only analyze images.';

/**
 * @constant
 * @description Follow-up message sent when downloading or analyzing an MMS image fails.
 */
export const MEDIA_ERROR_REPLY = "Sorry, I couldn't process your image. Please try again.";

/**
 * @constant
 * @type {number}
 * {@link https://www.twilio.com/docs/messaging/guides/accepted-mime-types}
 * @description Maximum size of an MMS media attachment accepted for download.
 */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/**
 * @constant
 * @description The only host MMS media may be downloaded from. Media URLs arrive in
 * signed webhook payloads, but pinning the host guards against fetching arbitrary
 * URLs with account credentials attached.
 */
export const TWILIO_MEDIA_HOST = 'api.twilio.com';
