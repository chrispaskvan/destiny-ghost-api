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
    var registrationText = 'Hi {{firstName}},\r\n\r\n' +
        'Please enter the following verification code for your email address.\r\n\r\n';
    var registrationHtml = '<img src=\'https://www.bungie.net/common/destiny_content/icons/4d6ee31e6bb0d28ffecd51a74a085a4f.png\'>Hi {{firstName}},\r\n\r\n' +
        'Please enter the following verification code for your email address.\r\n\r\n';
    var mailOptions = {
        from: 'destiny-ghost@apricothill.com'
    };

    var register = function (user) {
        _.extend(mailOptions, {
            subject: 'Your Email Registration Code for Destiny Ghost',
            text: new S(registrationText).template(user).s + user.tokens.emailAddress,
            to: user.emailAddress,
            html: new S(registrationHtml).template(user).s + user.tokens.emailAddress
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
        register: register
    };
};

module.exports = PostMaster;