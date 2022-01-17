const Joi = require('joi');

/**
 * Validate a value against a Joi schema.
 *
 * @param {Object} value
 * @param {Object} schema
 * @param {Object} options - optional pass through options for Joi
 * @returns void
 * @throws {Error} value(s) that violate schema
 */
module.exports = (value, schema, options = {}) => {
    const finalOptions = {
        abortEarly: false,
        ...options,
    };
    const result = Joi.attempt(value, Joi.object(schema), finalOptions);

    if (result.error) {
        throw result.error;
    }
};
