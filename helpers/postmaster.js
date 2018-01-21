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
const nodemailer = require('nodemailer'),
    S = require('string'),
    smtpConfiguration = require('../settings/smtp.json'),
    smtpTransport = require('nodemailer-smtp-transport');

const registrationHtml = 'Hi {{firstName}},<br /><br />' +
	'Please click the link below to continue the registration process.<br /><br />';
const registrationText = 'Hi {{firstName}},\r\n\r\n' +
	'Open the link below to continue the registration process.\r\n\r\n';
const mailOptions = {};
const transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));

class Postmaster {
	static _getRandomColor() {
		let color = '#';
		const letters = '0123456789ABCDEF';

		for (let index = 0; index < 6; index += 1) {
			color += letters[Math.floor(Math.random() * 16)];
		}

		return color;
	}

	register(user, image, url) {
		return new Promise((resolve, reject) => {
			Object.assign(mailOptions, {
				from: smtpConfiguration.from,
				tls: {
					rejectUnauthorized: false
				},
				subject: 'Destiny Ghost Registration',
				text: new S(registrationText).template(user).s + 'http://app.destiny-ghost.com' + url +
				'?token=' + user.membership.tokens.blob,
				to: user.emailAddress,
				html: (image ? '<img src=\'' + image + '\' style=\'background-color: ' +
					this.constructor._getRandomColor() + ';\'><br />' : '') +
				new S(registrationHtml).template(user).s + 'http://app.destiny-ghost.com' + url +
				'?token=' + user.membership.tokens.blob
			});
			transporter.sendMail(mailOptions, function (err, response) {
				if (err) {
					reject(err);
				} else {
					resolve(response);
				}
			});
		});
	}
}

module.exports = Postmaster;
