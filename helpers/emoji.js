// @ts-check
/**
 * A module for detecting and stripping emoji from inbound SMS/MMS text.
 *
 * @module Emoji
 * @author Chris Paskvan
 * @description Twilio delivers emoji in the `Body` field as literal Unicode
 * code points. This module extracts them so the controller can respond with
 * emoji-appropriate intent instead of running them through item search.
 */
import getEmojiRegex from 'emoji-regex';

/**
 * Built once: `emoji-regex` returns a new, large pattern on every call. It is
 * global, which `match` and `replace` reset before use, so sharing it is safe.
 */
const EMOJI = getEmojiRegex();
const VARIATION_SELECTOR = String.raw`\u{FE0E}\u{FE0F}`;
const VARIATION_SELECTORS = new RegExp(`[${VARIATION_SELECTOR}]`, 'gu');
const SKIN_TONE_MODIFIERS = /[\u{1F3FB}-\u{1F3FF}]/gu;
/**
 * What `emoji-regex` can leave behind: it matches 👍 but not a variation
 * selector some keyboards append to it, or a zero-width joiner between two
 * emoji it doesn't know as one sequence.
 */
const EMOJI_LEFTOVERS = new RegExp(String.raw`[${VARIATION_SELECTOR}\u{200D}]`, 'gu');

/**
 * Phones send a reaction to an SMS as text. iOS 18 and later write
 * `Reacted 👍 to “…”`; older iOS uses a verb, mapped here to the emoji its
 * tapback shows. The reaction can be to text, quoted, or to an attachment.
 * Whatever sits between `Reacted` and `to` counts, even when it isn't an
 * emoji `emoji-regex` knows (one newer than the package, or a sticker), so a
 * reaction is never searched as an item name.
 */
const REACTION_TARGET = String.raw`(?:[“"][\s\S]*[”"]|an? (?:image|photo|video|movie|attachment|audio message))`;
const EMOJI_REACTION = new RegExp(`^Reacted (.+?) to ${REACTION_TARGET}$`, 'u');
const TAPBACK_REACTION = new RegExp(
    `^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned) ${REACTION_TARGET}$`,
    'u',
);
const REMOVED_REACTION = new RegExp(`^Removed .+? from ${REACTION_TARGET}$`, 'u');
const TAPBACK_EMOJI = new Map([
    ['Liked', '👍'],
    ['Loved', '❤'],
    ['Disliked', '👎'],
    ['Laughed at', '😂'],
    ['Emphasized', '‼'],
    ['Questioned', '❓'],
]);

/**
 * @function
 * @param {string} text - Inbound message text.
 * @returns {string[]} - All emoji found, in order of appearance.
 * @description Extracts every emoji sequence present in the given text.
 */
function extractEmoji(text = '') {
    return text.match(EMOJI) ?? [];
}

/**
 * @function
 * @param {string} emoji - A single emoji sequence.
 * @returns {string} - The emoji stripped of variation selectors (U+FE0E/U+FE0F)
 * and skin-tone modifiers, so lookalike sequences map to the same base emoji.
 * @description Twilio delivers emoji with inconsistent qualification (e.g. a
 * bare heart vs one with a variation selector, or a plain thumbs-down vs a
 * skin-toned one). Without normalizing, intent lookups keyed on the base
 * emoji silently miss these variants.
 */
function normalizeEmoji(emoji = '') {
    return emoji.replace(SKIN_TONE_MODIFIERS, '').replace(VARIATION_SELECTORS, '');
}

/**
 * @function
 * @param {string} text - Inbound message text.
 * @returns {string} - The text with all emoji removed, internal whitespace
 * collapsed to a single space, and leading/trailing whitespace trimmed.
 * @description Strips emoji from a message so the remaining text can be
 * processed as a normal keyword or item-search query.
 */
function stripEmoji(text = '') {
    return text.replace(EMOJI, '').replace(EMOJI_LEFTOVERS, '').replace(/\s+/g, ' ').trim();
}

/**
 * @function
 * @param {string} text - Inbound message text.
 * @returns {{ emoji?: string } | { removed: true } | undefined} - The
 * normalized emoji the sender reacted with (absent when it isn't one emoji),
 * `removed` when they took a reaction back, or undefined when the text isn't
 * a reaction.
 * @description Recognizes a reaction a phone sent as text, so it is answered
 * like the emoji itself rather than searched as an item name.
 */
function parseReaction(text = '') {
    if (REMOVED_REACTION.test(text)) {
        return { removed: true };
    }

    const [, reacted] = text.match(EMOJI_REACTION) ?? [];

    if (reacted) {
        const emoji = extractEmoji(reacted);

        return emoji.length === 1 && !stripEmoji(reacted)
            ? { emoji: normalizeEmoji(emoji[0]) }
            : {};
    }

    const [, verb] = text.match(TAPBACK_REACTION) ?? [];

    return verb ? { emoji: /** @type {string} */ (TAPBACK_EMOJI.get(verb)) } : undefined;
}

/**
 * @function
 * @param {string} text - Inbound message text.
 * @returns {string} - The text as STOP, HELP and START are matched against.
 * @description The one normalization for those keywords. The route uses it to
 * exempt them from the per-sender rate limit and the controller to act on
 * them, so a message can't be exempted as a keyword and then not be handled
 * as one.
 */
function toKeyword(text = '') {
    return stripEmoji(text).toLowerCase();
}

export { extractEmoji, stripEmoji, normalizeEmoji, parseReaction, toKeyword };
