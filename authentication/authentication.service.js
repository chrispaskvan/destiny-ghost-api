/**
 * User Authentication Service Class
 */
class AuthenticationService {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        this.cacheService = options.cacheService;
        this.destinyService = options.destinyService;
        this.userService = options.userService;
    }

    /**
     * Authenticate user by gamer tag and console or phone number.
     * @param {Object} options
     * @returns {Promise}
     */
    authenticate(options = {}) {
        const { displayName, membershipType, phoneNumber } = options;

        if (!(displayName && membershipType) && !phoneNumber) {
            return Promise.resolve();
        }

        let promise = phoneNumber ?
            this.userService.getUserByPhoneNumber(phoneNumber) :
            this.userService.getUserByDisplayName(displayName, membershipType);

        return promise
            .then(user => this._validate(user));
    }

    /**
     * Validate user access token with Bungie.
     * @param user
     * @returns {Promise}
	 * @private
	 */
	_validate(user) {
        if (!user) {
            return Promise.reject(new Error('User not found'));
        }

        const { bungie: { access_token: accessToken, refresh_token: refreshToken }} = user;

        return this.destinyService.getCurrentUser(accessToken)
            .then(() => {
                if (user) {
                    return this.cacheService.setUser(user)
                        .then(() => user);
                }

                throw new Error('Bungie user not found');
            })
            .catch(() => {
                return this.destinyService.getAccessTokenFromRefreshToken(refreshToken)
                    .then(bungie => {
                        if (bungie) {
                            user.bungie = bungie;

                            return Promise.all([
                                this.cacheService.setUser(user),
                                this.userService.updateUserBungie(user.id, bungie)
                            ])
                                .then(() => user);
                        }

                        throw new Error('Bungie user failed to authenticate');
                    });
            });
    }
}

module.exports = AuthenticationService;
