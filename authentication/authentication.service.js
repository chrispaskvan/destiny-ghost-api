const Joi = require('@hapi/joi');
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

        return this.validateUser(user); // eslint-disable-line no-underscore-dangle
    }

    /**
     * Validate user access token with Bungie.
     * @private
     * @param user
     * @returns {Promise}
     * @private
     */
    // eslint-disable-next-line max-len
    async validateUser(user = {}) {
        const { bungie: { access_token: accessToken, refresh_token: refreshToken } = {} } = user;
        if (!accessToken) {
            return Promise.resolve();
        }

        try {
            user = await this.destinyService.getCurrentUser(accessToken); // eslint-disable-line max-len, no-param-reassign
        } catch (err) {
            const bungie = await this.destinyService.getAccessTokenFromRefreshToken(refreshToken);

            user.bungie = bungie; // eslint-disable-line no-param-reassign
            await Promise.all([
                this.cacheService.setUser(user),
                this.userService.updateUserBungie(user.id, bungie),
            ]);

            return user;
        }

        return { bungie: { access_token: accessToken, refresh_token: refreshToken }, ...user };
    }
}

module.exports = AuthenticationService;
