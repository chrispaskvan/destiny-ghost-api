/**
 * User Authentication Controller Class
 */
class AuthenticationController {
    /**
     * @constructor
     * @param authenticationService
     */
    constructor(authenticationService) {
        this.authentication = authenticationService;
    }

    /**
     * Authenticate user request.
     * @param req
     * @returns {Promise.<*>}
     */
    async authenticate(req) {
        const { session: { displayName, membershipType }, body: { From: phoneNumber }} = req;
        const user = await this.authentication.authenticate({ displayName, membershipType, phoneNumber });

        if (user) {
            if (!displayName) {
                req.session.displayName = user.displayName;
            }
            if (!membershipType) {
                req.session.membershipType = user.membershipType;
            }
        }

        return user;
    }
}

module.exports = AuthenticationController;
