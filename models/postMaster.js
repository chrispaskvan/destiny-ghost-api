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

var Postmaster = function () {
    var transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));
    var registrationText = 'Hi {{firstName}},\r\n\r\n' +
        'Open the link below to continue the registration process.\r\n\r\n';
    var registrationHtml = 'Hi {{firstName}},<br /><br />' +
        'Please click the link below to continue the registration process.<br /><br />';
    var mailOptions = {
        from: 'destiny-ghost@apricothill.com'
    };

    var register = function (user, image, url) {
        _.extend(mailOptions, {
            subject: 'Destiny Ghost Registration',
            text: new S(registrationText).template(user).s + process.env.DOMAIN + url + '?token=' + user.tokens.emailAddress,
            to: user.emailAddress,
            html: (image ? '<img src=\'' + image + '\' style=\'background-color: slategray;\'><br />' : '') +
                new S(registrationHtml).template(user).s + process.env.DOMAIN + url + '?token=' + user.tokens.emailAddress
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

module.exports = Postmaster;