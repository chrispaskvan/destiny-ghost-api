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
 * @param {string} text - Inbound message text.
 * @returns {string} - The text with all emoji removed and whitespace trimmed.
 * @description Strips emoji from a message so the remaining text can be
 * processed as a normal keyword or item-search query.
 */
function stripEmoji(text = '') {
    return text.replace(getEmojiRegex(), '').replace(/\s+/g, ' ').trim();
}

export { extractEmoji, stripEmoji };
