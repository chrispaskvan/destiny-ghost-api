const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');
const { smtp: smtpConfiguration } = require('./config');

const mailOptions = {};
const website = process.env.WEBSITE;

/**
 * Postmaster Class
 */
class Postmaster {
    constructor() {
        this.transporter = nodemailer.createTransport(smtpTransport(smtpConfiguration));
    }

    /**
     * Get a random color.
     *
     * @returns {string}
     * @private
     */
    static #getRandomColor() {
        let color = '#';
        const letters = '0123456789ABCDEF';

        for (let index = 0; index < 6; index += 1) {
            color += letters[Math.floor(Math.random() * 16)];
        }

        return color;
    }

    /**
     * Send registration email to user.
     *
     * @param user
     * @param image
     * @param url
     * @returns {Promise}
     */
    register({ emailAddress, firstName, membership: { tokens: { blob } } }, image, url) {
        return new Promise((resolve, reject) => {
            Object.assign(mailOptions, {
                from: smtpConfiguration.from,
                tls: {
                    rejectUnauthorized: false,
                },
                subject: 'Destiny Ghost Registration',
                text: `Hi ${firstName},\r\n\r\nOpen the link below to continue the registration process.\r\n\r\n${website}${url}?token=${blob}`,
                to: emailAddress,
                html: `${(image ? `<img src='${image}' style='background-color: ${this.constructor.#getRandomColor()};'><br />` : '')}Hi ${firstName},<br /><br />Please click the link below to continue the registration process.<br /><br />${website}${url}?token=${blob}`,
            });

            this.transporter.sendMail(mailOptions, (err, response) => {
                if (err) {
                    reject(err);
                }

                resolve(response);
            });
        });
    }
}

module.exports = Postmaster;
