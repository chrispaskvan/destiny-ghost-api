const Joi = require('joi');
const validate = require('../helpers/validate');

/**
 * User Authentication Service Class
 */
class AuthenticationService {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        validate(options, {
            cacheService: Joi.object().required(),
            destinyService: Joi.object().required(),
            userService: Joi.object().required(),
        });

        this.cacheService = options.cacheService;
        this.destinyService = options.destinyService;
        this.userService = options.userService;
    }

    /**
     * Authenticate user by gamer tag and console or phone number.
     * @param {Object} options
     * @returns {Promise}
     */
    async authenticate(options = {}) {
        const { displayName, membershipType, phoneNumber } = options;

        if (!(displayName && membershipType) && !phoneNumber) {
            return Promise.resolve();
        }

        const user = await (phoneNumber
            ? this.userService.getUserByPhoneNumber(phoneNumber)
            : this.userService.getUserByDisplayName(displayName, membershipType));

        return this.#validateUser(user);
    }

    /**
     * Validate user access token with Bungie.
     * @param user
     * @returns {Promise}
     * @private
     */
    async #validateUser(user = {}) {
        const {
            bungie: {
                access_token: accessToken,
                membership_id: membershipId,
                refresh_token: refreshToken,
                _ttl: ttl = 0,
            } = {},
            dateRegistered,
        } = user;
        const now = Date.now();

        if (!accessToken) {
            return Promise.resolve();
        }

        if (ttl < now) {
            try {
                // eslint-disable-next-line no-param-reassign
                user = await this.destinyService.getCurrentUser(accessToken);
            } catch (err) {
                const bungie = await this.destinyService
                    .getAccessTokenFromRefreshToken(refreshToken);

                bungie._ttl = now + bungie.expires_in * 1000; // eslint-disable-line max-len, no-underscore-dangle
                user.bungie = bungie; // eslint-disable-line no-param-reassign
                await Promise.all([
                    this.cacheService.setUser(user),
                    this.userService.updateUserBungie(user.id, bungie),
                ]);

                return user;
            }
        }

        return {
            bungie: {
                access_token: accessToken,
                membership_id: membershipId,
                refresh_token: refreshToken,
            },
            dateRegistered,
            ...user,
        };
    }
}

module.exports = AuthenticationService;
