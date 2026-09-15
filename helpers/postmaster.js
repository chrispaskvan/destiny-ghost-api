// @ts-check
import nodemailer from 'nodemailer';
import configuration from './config.js';
import { withRetry } from './retry.js';

const { smtp: smtpConfiguration } = configuration;
const website = process.env.WEBSITE;

const SMTP_CONNECTION_ERRORS = new Set(['ECONNECTION', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET']);

/**
 * The subset of a user this module reads to send an email.
 * @typedef {Object} EmailUser
 * @property {string} emailAddress
 * @property {string} firstName
 * @property {{ tokens: { blob: string } }} membership
 */

/**
 * Postmaster Class
 */
class Postmaster {
    constructor() {
        this.transporter = nodemailer.createTransport(smtpConfiguration);
    }

    /**
     * Get a random color.
     *
     * @returns {string}
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
     * @param {EmailUser} user - User object with emailAddress, firstName, and membership.tokens.blob
     * @param {string | undefined} image - Optional image URL
     * @param {string} url - URL path for the action
     * @param {string} action - Action type ('registration' or 'confirmation')
     * @returns {Promise<*>}
     */
    #sendEmail(user, image, url, action) {
        const {
            emailAddress,
            firstName,
            membership: {
                tokens: { blob },
            },
        } = user;
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
            html: `${image ? `<img src='${image}' style='background-color: ${Postmaster.#getRandomColor()};'><br /><br />` : ''}Hi ${firstName},<br /><br />Please click the link below to continue the ${actionText} process.<br /><br />${website}${url}?token=${blob}`,
        };

        return withRetry(() => this.transporter.sendMail(mailOptions), {
            shouldRetry: (/** @type {Error & { code?: string } } */ err) =>
                err.code !== undefined && SMTP_CONNECTION_ERRORS.has(err.code),
            maxRetries: 1,
        });
    }

    /**
     * Send confirmation email to user.
     *
     * @param {EmailUser} user
     * @param {string | undefined} image
     * @param {string} url
     * @returns {Promise<*>}
     */
    confirm(user, image, url) {
        return this.#sendEmail(user, image, url, 'confirmation');
    }

    /**
     * Send registration email to user.
     *
     * @param {EmailUser} user
     * @param {string | undefined} image
     * @param {string} url
     * @returns {Promise<*>}
     */
    register(user, image, url) {
        return this.#sendEmail(user, image, url, 'registration');
    }
}

export default Postmaster;
