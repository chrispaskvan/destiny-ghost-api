/**
 * User Authentication Class
 */
class UserAuthentication {
    /**
     * @constructor
     */
    constructor(cacheService, destinyService, userService) {
        this.cacheService = cacheService;
        this.destinyService = destinyService;
        this.userService = userService;
    }

    authenticate(options = {}) {
        const { displayName, membershipType, phoneNumber } = options;

        if (!(displayName && membershipType) && !phoneNumber) {
            return Promise.resolve();
        }

        let promise = phoneNumber ?
            this.userService.getUserByPhoneNumber(phoneNumber) :
            this.userService.getUserByDisplayName(displayName, membershipType);

        return promise
            .then(this.validateUser);
    }

    authenticateRequest(req) {
        const { session: { displayName, membershipType }, body: { From: phoneNumber }} = req;

        return this.authenticate({ displayName, membershipType, phoneNumber })
            .then(user => {
                if (!displayName) {
                    req.session.displayName = user.displayName;
                }
                if (!membershipType) {
                    req.session.membershipType = user.membershipType;
                }
            })
            .catch(err => {
                console.log(err); // TodO
            });
    }

    validateUser(user) {
        if (!user) {
            return Promise.reject(new Error('User not found'));
        }

        const { bungie: { accessToken: { value: accessToken }, refreshToken: { value: refreshToken }}} = user;

        return this.destinyService.getCurrentUser(accessToken)
            .then(() => {
                if (user) {
                    if (user.dateRegistered) {
                        return this.cacheService.setUser(user);
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
                                ]);
                            } else {
                                return this.userService.updateAnonymousUser(user);
                            }
                        }

                        throw new Error('Bungie user failed to authenticate');
                    });
            });
    }
}

exports = module.exports = UserAuthentication;
