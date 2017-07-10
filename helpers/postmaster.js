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
    var registrationHtml = 'Hi {{firstName}},<br /><br />' +
        'Please click the link below to continue the registration process.<br /><br />';
    var registrationText = 'Hi {{firstName}},\r\n\r\n' +
        'Open the link below to continue the registration process.\r\n\r\n';
    var mailOptions = {};
    var transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));

    function getRandomColor() {
        var color = '#';
        var index;
        var letters = '0123456789ABCDEF';

        for (index = 0; index < 6; index += 1) {
            color += letters[Math.floor(Math.random() * 16)];
        }

        return color;
    }

    var register = function (user, image, url) {
        var deferred = Q.defer();
        _.extend(mailOptions, {
            from: smtpConfiguration.from,
            tls: {
                rejectUnauthorized: false
            },
            subject: 'Destiny Ghost Registration',
            text: new S(registrationText).template(user).s + 'http://app.destiny-ghost.com' + url +
                '?token=' + user.membership.tokens.blob,
            to: user.emailAddress,
            html: (image ? '<img src=\'' + image + '\' style=\'background-color: ' +
                getRandomColor() + ';\'><br />' : '') +
                new S(registrationHtml).template(user).s + 'http://app.destiny-ghost.com' + url +
                '?token=' + user.membership.tokens.blob
        });
        transporter.sendMail(mailOptions, function (err, response) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(response);
            }
        });

        return deferred.promise;
    };

    return {
        register: register
    };
};

module.exports = Postmaster;