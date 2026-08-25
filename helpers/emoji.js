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

const VARIATION_SELECTORS = /[\u{FE0E}\u{FE0F}]/gu;
const SKIN_TONE_MODIFIERS = /[\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * @function
 * @param {string} text - Inbound message text.
 * @returns {string[]} - All emoji found, in order of appearance.
 * @description Extracts every emoji sequence present in the given text.
 */
function extractEmoji(text = '') {
    return Array.from(text.matchAll(getEmojiRegex()), match => match[0]);
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
 * @returns {string} - The text with all emoji removed and whitespace trimmed.
 * @description Strips emoji from a message so the remaining text can be
 * processed as a normal keyword or item-search query.
 */
function stripEmoji(text = '') {
    return text.replace(getEmojiRegex(), '').replace(/\s+/g, ' ').trim();
}

export { extractEmoji, stripEmoji, normalizeEmoji };
