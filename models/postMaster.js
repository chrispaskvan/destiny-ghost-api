/**
 * A module for managing custom email delivery.
 *
 * @module Postmaster
 * @summary Send email specific to base operations.
 * @author Chris Paskvan
 * @requires _
 * @requires @nodemailer
 * @requires Q
 * @requires S
 * @requires request
 * @requires nodemailer-smtp-transport
 */
var _ = require('underscore'),
    nodemailer = require('nodemailer'),
    Q = require('q'),
    S = require('string'),
    smtpConfiguration = require('../settings/smtp.json'),
    smtpTransport = require('nodemailer-smtp-transport');

var Postmaster = function () {
    'use strict';
    var transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));
    var registrationText = 'Hi {{firstName}},\r\n\r\n' +
        'Open the link below to continue the registration process.\r\n\r\n';
    var registrationHtml = 'Hi {{firstName}},<br /><br />' +
        'Please click the link below to continue the registration process.<br /><br />';
    var mailOptions = {
        from: 'destiny-ghost@apricothill.com'
    };

    var register = function (user, image, url) {
        var deferred = Q.defer();
        _.extend(mailOptions, {
            tls: {
                rejectUnauthorized: false
            },
            subject: 'Destiny Ghost Registration',
            text: new S(registrationText).template(user).s + process.env.DOMAIN + url + '?token=' + user.tokens.emailAddress,
            to: user.emailAddress,
            html: (image ? '<img src=\'' + image + '\' style=\'background-color: slategray;\'><br />' : '') +
                new S(registrationHtml).template(user).s + process.env.DOMAIN + url + '?token=' + user.tokens.emailAddress
        });
        transporter.sendMail(mailOptions, function (err, info) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(info.response);
            }
        });
        return deferred.promise;
    };
    return {
        register: register
    };
};

module.exports = Postmaster;