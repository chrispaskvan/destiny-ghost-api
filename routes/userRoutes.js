/**
 * Created by chris on 1/3/16.
 */
/**
 * Created by chris on 9/25/15.
 */
'use strict';
var AuthenticationController = require('../controllers/authenticationController'),
    express = require('express'),
    UserController = require('../controllers/userController');

var routes = function () {
    var userRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var authenticationController = new AuthenticationController();
    userRouter.route('/signIn')
        .post(authenticationController.signIn);
    var userController = new UserController();
    userRouter.route('/register')
        .post(userController.register);
    return userRouter;
};

module.exports = routes;