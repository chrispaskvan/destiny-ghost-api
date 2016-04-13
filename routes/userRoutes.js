/**
 * Created by chris on 1/3/16.
 */
var AuthenticationController = require('../controllers/authenticationController'),
    express = require('express'),
    UserController = require('../controllers/userController');

var routes = function () {
    'use strict';
    var userRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var authenticationController = new AuthenticationController();
    userRouter.route('/signIn/bungie')
        .post(function (req, res) {
            authenticationController.signIn(req, res);
        });
    var userController = new UserController();
    userRouter.route('/:emailAddress/emailAddress')
        .get(function (req, res) {
            userController.getEmailAddress(req, res);
        });
    userRouter.route('/:gamerTag/gamerTag')
        .get(function (req, res) {
            userController.getGamerTag(req, res);
        });
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(function (req, res) {
            userController.getPhoneNumber(req, res);
        });
    userRouter.route('/confirm')
        .post(function (req, res) {
            userController.confirm(req, res);
        });
    userRouter.route('/register')
        .post(function (req, res) {
            userController.register(req, res);
        });
    userRouter.route('/:gamerTag')
        .patch(function (req, res) {
            userController.update(req, res);
        });
    userRouter.route('/register/:emailAddressToken')
        .get(function (req, res) {
            userController.getUserByEmailAddressToken(req, res);
        });
    userRouter.route('/knock')
        .post(function (req, res) {
            userController.knock(req, res);
        });
    userRouter.route('/enter')
        .post(function (req, res) {
            userController.enter(req, res);
        });
    return userRouter;
};

module.exports = routes;