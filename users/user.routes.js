const AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
	RoleMiddleware = require('./role.middleware'),
	UserController = require('./user.controller'),
	cors = require('cors'),
	corsConfig = require('../settings/cors.' + (process.env.NODE_ENV || 'development') + '.json'),
	express = require('express');

const routes = function (authenticationController, destinyService, notificationService, userService, worldRepository) {
	const middleware = new AuthenticationMiddleWare(authenticationController);
	const roles = new RoleMiddleware(authenticationController);
	const userController = new UserController({ destinyService, notificationService, userService, worldRepository });
	const userRouter = express.Router();

	userRouter.all('*', cors(corsConfig));

	userRouter.route('/signUp')
		.post((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.signUp(req, res));

	userRouter.route('/join')
		.post((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.join(req, res));

	userRouter.route('/signIn/Bungie')
		.get((req, res) => userController.signIn(req, res));

	userRouter.route('/signOut')
		.get((req, res) => userController.signOut(req, res));

	userRouter.route('/:emailAddress/emailAddress')
		.get((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.getUserByEmailAddress(req, res));

	userRouter.route('/:phoneNumber/phoneNumber')
		.get((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.getUserByPhoneNumber(req, res));

	userRouter.route('/join')
		.post((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.join(req, res));

	userRouter.route('/current')
		.get((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.getCurrentUser(req, res));

	userRouter.route('/')
		.patch((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => userController.update(req, res));

	userRouter.route('/:id/version/:version')
		.get((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res, next) => roles.administrativeUser(req, res, next),
			(req, res) => userController.getUserById(req, res));

	return userRouter;
};

module.exports = routes;
