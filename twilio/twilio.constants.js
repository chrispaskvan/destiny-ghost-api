// @ts-check
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
    'SMS alerts, up to 1 msg/week. Msg&data rates may apply. Reply STOP to cancel. Help: banshee-44@destiny-ghost.com';

/**
 * @constant
 * @description Reply sent after a START keyword is received.
 */
export const START_REPLY =
    "You're re-subscribed. Up to 1 msg/week. Msg&data rates may apply. Reply HELP for help, STOP to cancel.";

/**
 * @constant
 * @description Reply acknowledging receipt of an MMS image queued for analysis.
 */
export const MEDIA_RECEIVED_REPLY = 'Scanning ...';

/**
 * @constant
 * @type {number}
 * @description Images scanned from one MMS; the rest are ignored. Each is a
 * Gemini call and a reply of its own, and a message can carry ten.
 */
export const MAX_IMAGES_PER_MESSAGE = 3;

/**
 * @constant
 * @description Reply acknowledging an MMS of which only some images will be
 * scanned: past `MAX_IMAGES_PER_MESSAGE`, or past the number's scans for the day.
 * @param {number} scanning
 * @param {number} sent
 * @returns {string}
 */
export const mediaPartialReply = (scanning, sent) => `Scanning ${scanning} of ${sent} ...`;

/**
 * @constant
 * @description Reply sent when a number has had its image scans for the day.
 */
export const MEDIA_LIMIT_REPLY =
    "My optics need to cool down, Guardian. That's all the scans I can run for you today.";

/**
 * @constant
 * @description The one reply a number gets once its replies for the day are
 * spent; after it, texts go unanswered until the day's window passes.
 */
export const DAILY_LIMIT_REPLY =
    "That's all the chatter my circuits can take today, Guardian. Talk tomorrow.";

/**
 * @constant
 * @description Reply sent when an MMS image could not be queued for analysis,
 * asking for it again: Twilio does not redeliver an inbound message on its own.
 */
export const MEDIA_RETRY_REPLY = 'Signal lost before I could scan that. Send it again, Guardian.';

/**
 * @constant
 * @description Reply sent when an MMS attachment is not an image.
 */
export const MEDIA_UNSUPPORTED_REPLY =
    'Negative, Guardian. Golden Age protocols are restricting me to optical scans only.';

/**
 * @constant
 * @description Follow-up message sent when downloading or analyzing an MMS image fails.
 */
export const MEDIA_ERROR_REPLY =
    'Scan inconclusive. Which usually means something big is about to try and kill us. Eyes up.';

/**
 * @constant
 * @description Follow-up message sent when an image analyzed cleanly but held no
 * recognizable display names.
 */
export const MEDIA_NO_PLAYERS_REPLY =
    "Well, either everyone already went back to orbit, or my optics are glitching. I can't make out a single Guardian here.";

/**
 * @constant
 * @description Stands in for a statistic that could not be looked up, so a player
 * the search cannot identify still appears in the reply. Shaped like the ratio it
 * stands in for, so a missing value leaves the column's width alone.
 */
export const UNKNOWN_STATISTIC = '?.??';

/**
 * @constant
 * @type {number}
 * @description How many players to look up at once. A roster is a dozen names and
 * each one costs a search plus a statistics call, so this keeps a single image from
 * firing all of them at the shared Bungie circuit breaker at once.
 */
export const PLAYER_LOOKUP_CONCURRENCY = 6;

/**
 * @constant
 * @type {number}
 * @description How many inbound MMS jobs one instance processes at once. Each
 * holds an AI call for most of its run, and production runs on a single core.
 */
export const MMS_CONCURRENCY = 2;

/**
 * @constant
 * @type {number}
 * @description How many times an MMS job whose worker died is picked up again
 * before it is failed. A job resumes from its saved progress, so it is allowed
 * as many as a broadcast.
 */
export const MMS_MAX_STALLED_COUNT = 5;

/**
 * @constant
 * @type {number}
 * @description The roster screen's probability at or below which an image is
 * turned away before extraction. Set low on purpose: a real roster refused
 * costs the sender their answer, while junk let through only costs the
 * extraction call it would have cost anyway.
 */
export const ROSTER_REJECT_THRESHOLD = 0.2;

/**
 * @constant
 * @description Maps emoji-only inbound messages to an intent-specific reply,
 * so a 👍 or ❤️ doesn't fall through to item search and come back empty.
 * Keys are normalized (via {@link normalizeEmoji}) to their base sequence,
 * stripped of variation selectors and skin-tone modifiers, so lookalike
 * variants (e.g. a bare ❤ or a skin-toned 👎) still match.
 */
export const EMOJI_INTENT_REPLIES = new Map([
    ['👍', 'Copy that, Guardian. 👍'],
    ['👎', "I swear this worked in the Golden Age. Reply HELP if something's broken."],
    ['❤', 'Just doing my job, Guardian. ❤️'],
    ['🙏', 'Happy to help. Someone has to keep us from getting vaporized.'],
    ['‼', 'Eyes up, Guardian! ‼️'],
    ['❓', HELP_REPLY],
    ['❔', HELP_REPLY],
    ['🔥', "If Shaxx sees this, he's going to start yelling again. 🔥"],
    ['😂', '😂'],
    ['😢', "I've got your back, Guardian. Reply HELP if you need a hand."],
    [
        '👋',
        'Ready when you are, Guardian. Text a weapon name to scan, or reply HELP before we get shot at.',
    ],
]);

/**
 * @constant
 * @description Reply sent when an emoji-only message doesn't match a known
 * intent in {@link EMOJI_INTENT_REPLIES}.
 */
export const EMOJI_DEFAULT_REPLY = /** @type {string} */ (EMOJI_INTENT_REPLIES.get('👍'));

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
