/**
 * User Authentication Middleware
 */
'use strict';
var _ = require('underscore');
/**
 * @constructor
 */
function UserAuthentication(cacheService, destinyService, userService) {
    this.cacheService = cacheService;
    this.destinyService = destinyService;
    this.userService = userService;
}

UserAuthentication.prototype.authenticate = function () {
    var self = this;

    function getCurrentUser(res, next, user) {
        if (!user) {
            return res.status(401).end();
        }

        return self.destinyService.getCurrentUser(user.bungie.accessToken.value)
            .then(function (user) {
                if (user) {
                    if (user.dateRegistered) {
                        self.cacheService.setUser(user);
                    }

                    return next();
                } else {
                    res.status(401).end();
                }
            })
            .fail(function () {
                self.destinyService.getAccessTokenFromRefreshToken(user.bungie.refreshToken.value)
                    .then(function (bungie) {
                        _.extend(user, {
                            bungie: bungie
                        });
                        if (user.dateRegistered) {
                            self.cacheService.setUser(user)
                                .then(function () {
                                    return next();
                                });
                            self.userService.updateUser(user);
                        } else {
                            self.userService.updateAnonymousUser(user);
                        }
                    });
            });
    }

    return function (req, res, next) {
        const { method, session: { displayName, membershipType }, body: { From: phoneNumber }} = req;

        if (method === 'OPTIONS') {
            return next();
        }
        if (!displayName && !phoneNumber) {
            return res.status(401).end();
        }

        if (displayName) {
            self.userService.getUserByDisplayName(displayName, membershipType)
                .then(function (user) {
                    return getCurrentUser(res, next, user);
                })
                .fail(function (err) {
                    res.status(500).send(err.message);
                });
        } else {
            self.userService.getUserByPhoneNumber(phoneNumber)
                .then(function (user) {
                    req.session.displayName = user.displayName;
                    req.session.membershipType = user.membershipType;

                    return getCurrentUser(res, next, user);
                })
                .fail(function (err) {
                    res.status(500).send(err.message);
                });
        }
    };
};

exports = module.exports = UserAuthentication;