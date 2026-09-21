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

import pLimit from 'p-limit';

import configuration from '../helpers/config.js';
import mayDeliver from '../helpers/consent.js';
import log from '../helpers/log.js';
import { isTransientError, withRetry } from '../helpers/retry.js';
import {
    MAX_MEDIA_BYTES,
    MEDIA_ERROR_REPLY,
    MEDIA_NO_PLAYERS_REPLY,
    PLAYER_LOOKUP_CONCURRENCY,
    TWILIO_MEDIA_HOST,
    UNKNOWN_STATISTIC,
} from './twilio.constants.js';

const {
    twilio: { accountSid, authToken },
} = configuration;

/** @typedef {import('../destiny2/destiny2.service.js').default} Destiny2Service */

/**
 * One media attachment on an inbound MMS.
 * @typedef {Object} MmsMedia
 * @property {string} contentType - MIME type, e.g. 'image/jpeg'
 * @property {string} url - Twilio-hosted media URL
 */

/**
 * Lay the roster out as a column, the ratio first and the name after it.
 *
 * Leading with the ratio leaves the one variable width field last, so nothing
 * has to be padded between the two and every name starts at the same column.
 * That survives the proportional fonts most SMS clients render in, where
 * padding inserted between fields does not: a run of spaces is narrower than
 * the glyphs it is meant to line up against.
 *
 * Ratios are right aligned against the longest, so an occasional two digit
 * ratio shifts the names as a group rather than breaking the column, and a
 * missing one occupies the same width as a present one.
 *
 * @param {{ displayName: string, killDeathRatio: string }[]} roster
 * @returns {string}
 */
const formatRoster = roster => {
    const ratioWidth = Math.max(...roster.map(({ killDeathRatio }) => killDeathRatio.length));

    return roster
        .map(
            ({ displayName, killDeathRatio }) =>
                `${killDeathRatio.padStart(ratioWidth)} ${displayName}`,
        )
        .join('\n');
};

/**
 * MMS Service
 */
class MmsService {
    /**
     * @param {Object} options
     * @param {import('../helpers/ai.js').AI} options.aiService
     * @param {Destiny2Service} options.destiny2Service
     * @param {import('../notifications/notification.service.js').default} options.notificationService
     * @param {import('../users/user.service.js').default} options.userService
     */
    constructor(options) {
        this.ai = options.aiService;
        this.destiny2 = options.destiny2Service;
        this.notifications = options.notificationService;
        this.users = options.userService;
    }

    /**
     * Look up one player's lifetime PvP kill/death ratio.
     *
     * Bungie searches by name prefix, and a global display name is not unique on
     * its own - the numeric code is what separates two players who share one - so
     * anything other than a single exact match is reported as unknown rather than
     * guessed at. When the image gives a name carrying its code, that narrows the
     * match to the one player.
     *
     * @param {string} displayName
     * @returns {Promise<string | undefined>} The ratio, or undefined when the
     * player could not be identified.
     */
    async #getKillDeathRatio(displayName) {
        /**
         * The model transcribes what it sees, so the code may arrive spaced off
         * the name ("Player #1234") and keeps the leading zero the game displays
         * ("#0420") that Bungie's numeric field does not. Parsing settles both,
         * and an unreadable code falls back to matching on the name alone -
         * still safe, since only a lone exact match is trusted below.
         */
        const [name, rawCode] = displayName.split('#').map(part => part.trim());
        const code = Number.parseInt(rawCode, 10);
        const players =
            await /** @type {typeof import('../destiny2/destiny2.service.js').default} */ (
                this.destiny2.constructor
            ).findPlayers(name, 0);
        const matches = players.filter(
            player =>
                player.bungieGlobalDisplayName?.toLowerCase() === name.toLowerCase() &&
                (Number.isNaN(code) || player.bungieGlobalDisplayNameCode === code),
        );

        if (matches.length !== 1) {
            log.info({ displayName, matches: matches.length }, 'Could not identify the player');

            return undefined;
        }

        /**
         * The membership the player actually plays on: either the one cross save
         * points at, or an account that never enabled it.
         */
        const { membershipId, membershipType } =
            (matches[0].destinyMemberships ?? []).find(
                membership =>
                    membership.crossSaveOverride === membership.membershipType ||
                    membership.crossSaveOverride === 0,
            ) ?? {};
        const {
            pvp: { kdr },
        } = await this.destiny2.getPlayerStatistics(membershipId, membershipType);

        return kdr ?? undefined;
    }

    /**
     * Pair every display name with its kill/death ratio.
     *
     * Returns the parts rather than finished lines: the column widths depend on
     * the whole roster, so the formatting happens once, afterwards.
     *
     * @param {string[]} displayNames
     * @returns {Promise<{ displayName: string, killDeathRatio: string }[]>}
     */
    async #getRoster(displayNames) {
        const limit = pLimit(PLAYER_LOOKUP_CONCURRENCY);

        return await Promise.all(
            displayNames.map(displayName =>
                limit(async () => {
                    try {
                        const killDeathRatio = await this.#getKillDeathRatio(displayName);

                        return { displayName, killDeathRatio: killDeathRatio ?? UNKNOWN_STATISTIC };
                    } catch (err) {
                        /**
                         * One player Bungie cannot answer for must not cost the
                         * sender the rest of the roster.
                         */
                        log.warn({ err, displayName }, 'Failed to look up the player');

                        return { displayName, killDeathRatio: UNKNOWN_STATISTIC };
                    }
                }),
            ),
        );
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
     * Download each image, read the roster off it, reply with each player's
     * kill/death ratio, and clean up.
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
                 * Looked up and sent after the cleanup above rather than inside
                 * the try, so neither Bungie nor Twilio can keep the image on
                 * disk while they take their time.
                 */
                const roster = players.length ? await this.#getRoster(players) : [];

                /**
                 * `request()` checked consent before handing the image over,
                 * but a download and an AI call ago - the widest gap between
                 * an inbound message and its reply anywhere in the app, and
                 * wide enough for a STOP to have arrived inside it. No claim
                 * check here: this reply belongs to no notification run, so
                 * the suppression is recorded in the log alone.
                 */
                if (!(await mayDeliver({ users: this.users, phoneNumber: from }))) {
                    return;
                }

                /**
                 * The leading break pair puts the roster on its own lines: the
                 * brand prefix is added centrally when the message is sent, and
                 * a column reads badly when the first row starts after it.
                 */
                await this.notifications.sendMessage(
                    roster.length ? `\n\n${formatRoster(roster)}` : MEDIA_NO_PLAYERS_REPLY,
                    from,
                );
            }
        } catch (err) {
            log.error({ err, from }, 'Failed to process MMS media');

            try {
                /**
                 * Gated too. An apology is still an outbound message to a
                 * number that may have opted out while the work was running,
                 * and it carries no information the sender asked for.
                 */
                if (await mayDeliver({ users: this.users, phoneNumber: from })) {
                    await this.notifications.sendMessage(MEDIA_ERROR_REPLY, from);
                }
            } catch (sendErr) {
                log.error({ err: sendErr, from }, 'Failed to send the media failure reply');
            }
        }
    }
}

export default MmsService;
