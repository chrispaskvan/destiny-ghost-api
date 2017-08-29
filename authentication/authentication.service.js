/**
 * User Authentication Service Class
 */
class AuthenticationService {
    /**
     * @constructor
     */
    constructor(cacheService, destinyService, userService) {
        this.cacheService = cacheService;
        this.destinyService = destinyService;
        this.userService = userService;
    }

    /**
     * Authenticate User by Gamer Tag and Console or Phone Number
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
            .then(user => this.validate(user));
    }

    validate(user) {
        if (!user) {
            return Promise.reject(new Error('User not found'));
        }

        const { bungie: { accessToken: { value: accessToken }, refreshToken: { value: refreshToken }}} = user;

        return this.destinyService.getCurrentUser(accessToken)
            .then(() => {
                if (user) {
                    if (user.dateRegistered) {
                        return this.cacheService.setUser(user)
                            .then(() => user);
                    } else {
                        return user;
                    }
                }

                throw new Error('Bungie user not found');
            })
            .catch(() => {
                return this.destinyService.getAccessTokenFromRefreshToken(refreshToken)
                    .then(bungie => {
                        if (bungie) {
                            user.bungie = bungie;
                            if (user.dateRegistered) {
                                return Promise.all([
                                    this.cacheService.setUser(user),
                                    this.userService.updateUser(user)
                                ])
                                    .then(() => user);
                            } else {
                                return this.userService.updateAnonymousUser(user)
                                    .then(() => user);
                            }
                        }

                        throw new Error('Bungie user failed to authenticate');
                    });
            });
    }
}

exports = module.exports = AuthenticationService;
