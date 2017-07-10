/**
 * Created by chris on 1/3/16.
 */
var UserController = require('./user.controller'),
    express = require('express');

var routes = function (authenticateUser, destinyService, userService) {
    'use strict';
    var userRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var userController = new UserController(destinyService, userService);

    userRouter.route('/apply')
        .post(authenticateUser, function (req, res) {
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
        .get(authenticateUser, function (req, res) {
            userController.getEmailAddress(req, res);
        });
    userRouter.route('/:gamerTag/gamerTag/:membershipType')
        .get(authenticateUser, function (req, res) {
            userController.getGamerTag(req, res);
        });
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(authenticateUser, function (req, res) {
            userController.getPhoneNumber(req, res);
        });
    userRouter.route('/confirm')
        .post(authenticateUser, function (req, res) {
            userController.confirm(req, res);
        });
    userRouter.route('/current')
        .get(authenticateUser, function (req, res) {
            userController.getCurrentUser(req, res);
        });
    userRouter.route('/:gamerTag')
        .patch(authenticateUser, function (req, res) {
            userController.update(req, res);
        });
    userRouter.route('/register/:emailAddressToken')
        .get(authenticateUser, function (req, res) {
            userController.getUserByEmailAddressToken(req, res);
        });

    return userRouter;
};

module.exports = routes;