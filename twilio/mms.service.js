/**
 * A module for downloading and processing MMS media attachments.
 *
 * @module mmsService
 * @author Chris Paskvan
 */
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
     * Download a media attachment into the given directory.
     *
     * @param {{ contentType: string, url: string }} media
     * @param {string} directory - Private directory to download into.
     * @returns {Promise<string>} Path to the downloaded file.
     * @private
     */
    async #download({ contentType, url }, directory) {
        const { hostname, protocol } = new URL(url);

        if (protocol !== 'https:' || hostname !== TWILIO_MEDIA_HOST) {
            throw new Error(`Unexpected media URL origin ${protocol}//${hostname}`);
        }

        const filePath = join(directory, `image.${contentType.split('/')[1]}`);

        await withRetry(
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

                if (!response.body) {
                    throw new Error(`Media download returned no body for ${url}`);
                }

                /**
                 * Stream to disk while counting bytes so an oversized (or
                 * mislabeled) response is aborted at the cap instead of
                 * being buffered wholly into memory first.
                 */
                let bytes = 0;
                const guard = new Transform({
                    transform(chunk, _encoding, callback) {
                        bytes += chunk.length;
                        callback(
                            bytes > MAX_MEDIA_BYTES
                                ? new Error(`Media exceeds ${MAX_MEDIA_BYTES} bytes`)
                                : null,
                            chunk,
                        );
                    },
                });

                await pipeline(
                    Readable.fromWeb(response.body),
                    guard,
                    createWriteStream(filePath, { mode: 0o600 }),
                );
            },
            { shouldRetry: isTransientError },
        );

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
                /**
                 * mkdtemp creates a private (0700) directory, keeping the image
                 * out of the shared, world-writable temp directory (CodeQL
                 * js/insecure-temporary-file). Owned here for its whole
                 * lifecycle: created before the download, removed after
                 * analysis or on any failure in between.
                 */
                const directory = await mkdtemp(join(tmpdir(), 'mms-'));

                try {
                    const filePath = await this.#download(item, directory);

                    await MmsService.analyzeImage(filePath);
                } finally {
                    try {
                        await rm(directory, { force: true, recursive: true });
                    } catch (rmErr) {
                        log.warn({ err: rmErr, directory }, 'Failed to delete downloaded media');
                    }
                }
            }
        } catch (err) {
            log.error({ err, from }, 'Failed to process MMS media');

            try {
                await this.notifications.sendMessage(MEDIA_ERROR_REPLY, from);
            } catch (sendErr) {
                log.error({ err: sendErr, from }, 'Failed to send the media failure reply');
            }
        }
    }
}

export default MmsService;
