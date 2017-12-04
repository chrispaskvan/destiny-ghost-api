const AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
    RoleMiddleware = require('./role.middleware'),
	UserController = require('./user.controller'),
    express = require('express');

const routes = function (authenticationController, destinyService, userService) {
	const middleware = new AuthenticationMiddleWare(authenticationController);
	const roles = new RoleMiddleware(authenticationController);
	const userController = new UserController({ destinyService, userService });
    const userRouter = express.Router();

    userRouter.route('/apply')
        .post(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.apply(req, res);
        });
    userRouter.route('/join')
        .post(function (req, res) {
            userController.join(req, res);
        });
    userRouter.route('/signin/bungie')
        .get(function (req, res) {
            userController.signIn(req, res);
        });
    userRouter.route('/signout')
        .get(function (req, res) {
            userController.signOut(req, res);
        });
    userRouter.route('/:emailAddress/emailAddress')
        .get(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.getUserByEmailAddress(req, res);
        });
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.getUserByPhoneNumber(req, res);
        });
    userRouter.route('/join')
        .post(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.join(req, res);
        });
    userRouter.route('/current')
        .get(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.getCurrentUser(req, res);
        });
    userRouter.route('/')
        .patch(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.update(req, res);
        });
	userRouter.route('/:id/version/:version')
		.get(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res, next) {
			roles.administrativeUser(req, res, next);
		}, function (req, res) {
			userController.getUserById(req, res);
		});

    return userRouter;
};

module.exports = routes;
