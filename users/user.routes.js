/**
 * Created by chris on 1/3/16.
 */
var UserController = require('./user.controller'),
    AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
    express = require('express');

var routes = function (authenticationController, destinyService, userService) {
    'use strict';
    var userRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var userController = new UserController(destinyService, userService);
    const middleware = new AuthenticationMiddleWare(authenticationController)

    userRouter.route('/apply')
        .post(function (req, res) {
            //authenticateUser,
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
        .get(function (req, res) {
            //authenticateUser,
            userController.getEmailAddress(req, res);
        });
    userRouter.route('/:gamerTag/gamerTag/:membershipType')
        .get(function (req, res) {
            //authenticateUser,
            userController.getGamerTag(req, res);
        });
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(function (req, res) {
            //authenticateUser,
            userController.getPhoneNumber(req, res);
        });
    userRouter.route('/confirm')
        .post(function (req, res) {
            //authenticateUser,
            userController.confirm(req, res);
        });
    userRouter.route('/current')
        .get(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            userController.getCurrentUser(req, res);
        });
    userRouter.route('/:gamerTag')
        .patch(function (req, res) {
            //authenticateUser,
            userController.update(req, res);
        });
    userRouter.route('/register/:emailAddressToken')
        .get(function (req, res) {
            //authenticateUser,
            userController.getUserByEmailAddressToken(req, res);
        });

    return userRouter;
};

module.exports = routes;