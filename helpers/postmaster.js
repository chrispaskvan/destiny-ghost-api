import { createTransport } from 'nodemailer';
import smtpTransport from 'nodemailer-smtp-transport';
import configuration from './config';

const { smtp: smtpConfiguration } = configuration;
const website = process.env.WEBSITE;

/**
 * Postmaster Class
 */
class Postmaster {
    constructor() {
        this.transporter = createTransport(smtpTransport(smtpConfiguration));
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
     * Send email with user token
     * 
     * @param {Object} user - User object with emailAddress, firstName, and membership.tokens.blob
     * @param {string} image - Optional image URL
     * @param {string} url - URL path for the action
     * @param {string} action - Action type ('registration' or 'confirmation')
     * @returns {Promise}
     * @private
     */
    #sendEmail(user, image, url, action) {
        const { emailAddress, firstName, membership: { tokens: { blob } } } = user;
        
        return new Promise((resolve, reject) => {
            const actionText = action === 'registration' ? 'registration' : 'confirmation';
            const actionTitle = actionText.charAt(0).toUpperCase() + actionText.slice(1);
            
            const mailOptions = {
                from: smtpConfiguration.from,
                tls: {
                    rejectUnauthorized: false,
                },
                subject: `Destiny Ghost ${actionTitle}`,
                text: `Hi ${firstName},\r\n\r\nOpen the link below to continue the ${actionText} process.\r\n\r\n${website}${url}?token=${blob}`,
                to: emailAddress,
                html: `${(image ? `<img src='${image}' style='background-color: ${Postmaster.#getRandomColor()};'><br /><br />` : '')}Hi ${firstName},<br /><br />Please click the link below to continue the ${actionText} process.<br /><br />${website}${url}?token=${blob}`,
            };

            this.transporter.sendMail(mailOptions, (err, response) => {
                if (err) {
                    reject(err);
                }

                resolve(response);
            });
        });
    }

    /**
     * Send confirmation email to user.
     *
     * @param user
     * @param image
     * @param url
     * @returns {Promise}
     */
    confirm(user, image, url) {
        return this.#sendEmail(user, image, url, 'confirmation');
    }

    /**
     * Send registration email to user.
     *
     * @param user
     * @param image
     * @param url
     * @returns {Promise}
     */
    register(user, image, url) {
        return this.#sendEmail(user, image, url, 'registration');
    }
}

export default Postmaster;
