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
        .post(authenticationController.signIn);
    var userController = new UserController();
    userRouter.route('/:emailAddress/emailAddress')
        .get(userController.getEmailAddress);
    userRouter.route('/:gamerTag/gamerTag')
        .get(userController.getGamerTag);
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(userController.getPhoneNumber);
    userRouter.route('/confirm')
        .post(userController.confirm);
    userRouter.route('/register')
        .post(userController.register);
    userRouter.route('/:gamerTag')
        .patch(userController.update);
    userRouter.route('/register/:emailAddressToken')
        .get(userController.getUserByEmailAddressToken);
    userRouter.route('/knock')
        .post(userController.knock);
    userRouter.route('/enter')
        .post(userController.enter);
    return userRouter;
};

module.exports = routes;