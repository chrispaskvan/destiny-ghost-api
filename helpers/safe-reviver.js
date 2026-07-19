/**
 * A module for parsing JSON without prototype-polluting keys.
 *
 * @module safeReviver
 * @summary Reject __proto__ and constructor.prototype keys while parsing JSON.
 * @author Chris Paskvan
 */

/**
 * A reviver for JSON.parse that throws on keys capable of polluting
 * Object.prototype when the parsed value is later merged or copied.
 *
 * @param {string} key - The property name under evaluation.
 * @param {*} value - The revived property value.
 * @returns {*} The value, unchanged.
 * @throws {SyntaxError} When the key is __proto__ or a constructor with a prototype property.
 */
export default function safeReviver(key, value) {
    if (key === '__proto__') {
        throw new SyntaxError('"__proto__" is not an allowed property name.');
    }

    if (
        key === 'constructor' &&
        value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'prototype')
    ) {
        throw new SyntaxError('"constructor.prototype" is not an allowed property.');
    }

    return value;
}
