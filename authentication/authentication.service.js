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

        return this._validateUser(user); // eslint-disable-line no-underscore-dangle
    }

    /**
     * Validate user access token with Bungie.
     * @param user
     * @returns {Promise}
     * @private
     */
    _validateUser(user = {}) {
        const { bungie: { access_token: accessToken, refresh_token: refreshToken } = {} } = user;

        if (!accessToken) {
            return Promise.resolve();
        }

        return this.destinyService.getCurrentUser(accessToken)
            .then(() => this.cacheService.setUser(user)
                .then(() => user))
            .catch(() => this.destinyService.getAccessTokenFromRefreshToken(refreshToken)
                .then(bungie => {
                    user.bungie = bungie; // eslint-disable-line no-param-reassign

                    return Promise.all([
                        this.cacheService.setUser(user),
                        this.userService.updateUserBungie(user.id, bungie),
                    ])
                        .then(() => user);
                }));
    }
}

module.exports = AuthenticationService;
