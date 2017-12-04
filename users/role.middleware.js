const administrators = require('../settings/administrators.json');

/**
 * User Authentication Middleware Class
 */
class RoleMiddleware {
	/**
	 * @constructor
	 * @param authenticationController
	 */
	constructor(authenticationController) {
		this.authentication = authenticationController;
	}

	/**
	 * Authenticate user request.
	 * @param req
	 * @param res
	 * @param next
	 * @returns {Promise.<void>}
	 */
	async administrativeUser(req, res, next) {
		const user = await this.authentication.authenticate(req);
		if (user) {
			if (administrators.find(administrator =>
					administrator.displayName === user.displayName && administrator.membershipType === user.membershipType)) {
				next();
			} else {
				res.status(401).end();
			}
		} else {
			res.status(401).end();
		}
	}
}

module.exports = RoleMiddleware;
