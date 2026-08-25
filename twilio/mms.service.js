/**
 * A module for downloading and processing MMS media attachments.
 *
 * @module mmsService
 * @author Chris Paskvan
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import configuration from '../helpers/config.js';
import log from '../helpers/log.js';
import { isTransientError, withRetry } from '../helpers/retry.js';
import { MAX_MEDIA_BYTES, MEDIA_ERROR_REPLY, TWILIO_MEDIA_HOST } from './twilio.constants.js';

const {
    twilio: { accountSid, authToken },
} = configuration;

/**
 * MMS Service
 */
class MmsService {
    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.notifications = options.notificationService;
    }

    /**
     * Upload the downloaded image to the AI service for analysis.
     *
     * Stub: the follow-up issue wires this to ai#getPlayersFromFile
     * (helpers/ai.js), which already accepts a file path.
     *
     * @param {string} filePath - Path to the downloaded image.
     * @returns {Promise<void>}
     */
    static async analyzeImage(filePath) {
        log.info({ filePath }, 'Image ready for AI analysis');
    }

    /**
     * Download a media attachment to a temporary file.
     *
     * @param {{ contentType: string, url: string }} media
     * @returns {Promise<string>} Path to the downloaded file.
     * @private
     */
    async #download({ contentType, url }) {
        const { hostname } = new URL(url);

        if (hostname !== TWILIO_MEDIA_HOST) {
            throw new Error(`Unexpected media host ${hostname}`);
        }

        const buffer = await withRetry(
            async () => {
                const response = await fetch(url, {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                    },
                });

                if (!response.ok) {
                    throw Object.assign(new Error(`Media download failed for ${url}`), {
                        status: response.status,
                    });
                }

                return Buffer.from(await response.arrayBuffer());
            },
            { shouldRetry: isTransientError },
        );

        if (buffer.byteLength > MAX_MEDIA_BYTES) {
            throw new Error(`Media of ${buffer.byteLength} bytes exceeds ${MAX_MEDIA_BYTES}`);
        }

        /**
         * mkdtemp creates a private (0700) directory, keeping the image out of
         * the shared, world-writable temp directory (CodeQL
         * js/insecure-temporary-file).
         */
        const directory = await mkdtemp(join(tmpdir(), 'mms-'));
        const filePath = join(directory, `image.${contentType.split('/')[1]}`);

        await writeFile(filePath, buffer, { mode: 0o600 });

        return filePath;
    }

    /**
     * Download each image, hand it to the AI analysis stub, and clean up.
     * Never rejects: the webhook has already acknowledged receipt, so failures
     * are logged and reported to the sender as a follow-up message instead.
     *
     * @param {Object} options
     * @param {string} options.from - The sender's phone number.
     * @param {{ contentType: string, url: string }[]} options.media
     * @returns {Promise<void>}
     */
    async process({ from, media }) {
        try {
            for (const item of media) {
                const filePath = await this.#download(item);

                try {
                    await MmsService.analyzeImage(filePath);
                } finally {
                    await rm(dirname(filePath), { force: true, recursive: true }).catch(err =>
                        log.warn({ err, filePath }, 'Failed to delete downloaded media'),
                    );
                }
            }
        } catch (err) {
            log.error({ err, from }, 'Failed to process MMS media');
            await this.notifications
                .sendMessage(MEDIA_ERROR_REPLY, from)
                .catch(sendErr =>
                    log.error({ err: sendErr, from }, 'Failed to send the media failure reply'),
                );
        }
    }
}

export default MmsService;
