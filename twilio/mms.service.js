// @ts-check
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
import {
    MAX_MEDIA_BYTES,
    MEDIA_ERROR_REPLY,
    MEDIA_NO_PLAYERS_REPLY,
    TWILIO_MEDIA_HOST,
} from './twilio.constants.js';

const {
    twilio: { accountSid, authToken },
} = configuration;

/**
 * One media attachment on an inbound MMS.
 * @typedef {Object} MmsMedia
 * @property {string} contentType - MIME type, e.g. 'image/jpeg'
 * @property {string} url - Twilio-hosted media URL
 */

/**
 * MMS Service
 */
class MmsService {
    /**
     * @param {Object} options
     * @param {import('../helpers/ai.js').AI} options.aiService
     * @param {import('../notifications/notification.service.js').default} options.notificationService
     */
    constructor(options) {
        this.ai = options.aiService;
        this.notifications = options.notificationService;
    }

    /**
     * Read the display names off the downloaded image.
     *
     * The AI answers with one comma delimited line, so a blank response yields a
     * single empty entry rather than no entries - both mean the same thing here
     * and both collapse to an empty list.
     *
     * @param {string} filePath - Path to the downloaded image.
     * @returns {Promise<string[]>} Display names, in the order they appear.
     */
    async analyzeImage(filePath) {
        const players = (await this.ai.getPlayersFromFile(filePath)) ?? [];
        const displayNames = players.map(player => player.trim()).filter(Boolean);

        log.info({ filePath, playerCount: displayNames.length }, 'Image analyzed');

        return displayNames;
    }

    /**
     * Download a media attachment into the given directory.
     *
     * @param {MmsMedia} media
     * @param {string} directory - Private directory to download into.
     * @returns {Promise<string>} Path to the downloaded file.
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
     * Download each image, analyze it, reply with what it held, and clean up.
     * Never rejects: the webhook has already acknowledged receipt, so failures
     * are logged and reported to the sender as a follow-up message instead.
     *
     * @param {Object} options
     * @param {string} options.from - The sender's phone number.
     * @param {MmsMedia[]} options.media
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
                 * analysis or on any failure in between. In production the
                 * image sets TMPDIR to a directory the permission model grants
                 * both read and write access to, since /tmp is neither - the
                 * recursive rm below lstats the directory, so a write-only
                 * grant leaks it.
                 */
                const directory = await mkdtemp(join(tmpdir(), 'mms-'));

                let players;

                try {
                    const filePath = await this.#download(item, directory);

                    players = await this.analyzeImage(filePath);
                } finally {
                    try {
                        await rm(directory, { force: true, recursive: true });
                    } catch (rmErr) {
                        log.warn({ err: rmErr, directory }, 'Failed to delete downloaded media');
                    }
                }

                /**
                 * Sent after the cleanup above rather than inside the try, so a
                 * slow round trip to Twilio cannot keep the image on disk.
                 */
                await this.notifications.sendMessage(
                    players.length ? players.join('\n') : MEDIA_NO_PLAYERS_REPLY,
                    from,
                );
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
