/**
 * A module for managing custom Bitlinks.
 *
 * @module Bitly
 * @summary Create a Short URL
 * @author Chris Paskvan
 * @description Manage custom Bitlinks for a Bitly account identified
 * by an access token within the JSON settings file. For additional reference
 * go to {@link http://dev.bitly.com/api.html}.
 * @requires fs
 * @requires Q
 * @requires request
 * @requires util
 */
'use strict';
var _ = require('underscore'),
    nodemailer = require('nodemailer'),
    S = require('string'),
    smtpConfiguration = require('../settings/smtp.json'),
    smtpTransport = require('nodemailer-smtp-transport');

var PostMaster = function () {
    var transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));
    var registrationText = 'Hi {{firstName}},\r\n' +
        'Please enter the following verification code for your email address.\r\n' +
        '{{token}}';
    var registrationHtml = 'Hi {{firstName}},\r\n' +
        'Please enter the following verification code for your email address.\r\n' +
        '{{token}}';
    var mailOptions = {
        from: 'destiny-ghost@apricothill.com'
    };

    var sendRegistration = function (user) {
        _.extend(mailOptions, {
            subject: 'Your Registration Code for Destiny Ghost',
            text: new S(registrationText).template(user).s,
            to: user.email
        });
        transporter.sendMail(mailOptions, function (err, response) {
            if (err) {
                console.log(err);
            } else {
                console.log(response.response);
            }
        });
    };
    return {
        sendRegistration: sendRegistration
    };
};

module.exports = PostMaster;