import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SendOutcomeUnknownError from '../notifications/send-outcome-unknown.error.js';
import ConsentUnavailableError from './consent-unavailable.error.js';
import ProgressUnsavedError from './progress-unsaved.error.js';
import MmsService from './mms.service.js';
import {
    MAX_MEDIA_BYTES,
    MEDIA_ERROR_REPLY,
    MEDIA_NO_PLAYERS_REPLY,
    MMS_CONCURRENCY,
    UNKNOWN_STATISTIC,
} from './twilio.constants.js';

/**
 * The shared Redis client connects as it is imported, so it is replaced here
 * (#783). Reached through the consent gate's marker read, which finds no
 * marker and leaves the decision to the stored state.
 */
const { enqueueMms, listen } = vi.hoisted(() => ({ enqueueMms: vi.fn(), listen: vi.fn() }));

/** The service registers its worker on construction, and both modules connect on import. */
vi.mock('../helpers/subscriber.js', () => ({ default: { listen } }));
vi.mock('./mms.queue.js', () => ({ enqueueMms, QUEUE_NAME: 'mms' }));

vi.mock('../helpers/cache.js', () => {
    const cache = { hGetAll: vi.fn(async () => ({})), eval: vi.fn(async () => 1) };

    cache.withCommandOptions = vi.fn(() => cache);

    return { default: cache };
});

const from = '+15005550006';
const messageSid = `MM${'1'.repeat(32)}`;
const url = 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123';
const aiService = { getPlayersFromFile: vi.fn(), getRosterProbability: vi.fn() };

/**
 * findPlayers is static on the real service and reached through the instance's
 * constructor, so the double has to be a class rather than an object literal.
 */
class FakeDestiny2Service {
    static findPlayers = vi.fn();

    getPlayerStatistics = vi.fn();
}

const destiny2Service = new FakeDestiny2Service();
const notificationService = { sendMessage: vi.fn() };
const sentMessage = { sid: 'SM1', status: 'sent' };
const userService = { getConsentByPhoneNumber: vi.fn() };
const playerMatching = (bungieGlobalDisplayName, overrides = {}) => ({
    bungieGlobalDisplayName,
    bungieGlobalDisplayNameCode: 1234,
    destinyMemberships: [
        {
            membershipId: '4611686018',
            membershipType: 3,
            displayName: bungieGlobalDisplayName,
            crossSaveOverride: 3,
        },
    ],
    ...overrides,
});

let mmsService;
let job;

/**
 * A job as BullMQ hands it over, whose `updateData` saves the way Redis
 * would, so a second run of the same job sees what the first one saved.
 * @param {object} [progress]
 */
const jobWith = progress => {
    const fake = {
        data: { body: '{}', ...(progress && { progress }) },
        updateData: vi.fn(async data => {
            fake.data = data;
        }),
    };

    return fake;
};

/** Run the worker on a message with the given media. */
const run = ({ from: sender = from, media }) =>
    mmsService.process({ messageSid, from: sender, media }, job);

beforeEach(() => {
    vi.clearAllMocks();
    aiService.getPlayersFromFile.mockResolvedValue(['Player1', 'Player2']);
    aiService.getRosterProbability.mockResolvedValue(undefined);
    FakeDestiny2Service.findPlayers.mockImplementation(async name => [playerMatching(name)]);
    destiny2Service.getPlayerStatistics.mockResolvedValue({ pvp: { kdr: '1.42' } });
    /**
     * The real service checks `guard` inside the rate limiter's slot; a double
     * that ignored it would let a suppression test pass on a send that would
     * really have gone out.
     */
    notificationService.sendMessage.mockImplementation(
        async (_body, _to, _mediaUrl, { guard } = {}) =>
            guard && !(await guard()) ? undefined : sentMessage,
    );
    userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });
    mmsService = new MmsService({ aiService, destiny2Service, notificationService, userService });
    job = jobWith();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('MmsService', () => {
    describe('process', () => {
        describe('when the media downloads successfully', () => {
            it('should analyze the image from a temporary file and delete it afterward', async () => {
                let snapshot;

                aiService.getPlayersFromFile.mockImplementation(async filePath => {
                    snapshot = {
                        content: readFileSync(filePath, 'utf8'),
                        filePath,
                    };

                    return ['Player1', 'Player2'];
                });

                const fetchMock = vi
                    .fn()
                    .mockResolvedValue(new Response('image-bytes', { status: 200 }));

                vi.stubGlobal('fetch', fetchMock);

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(fetchMock).toHaveBeenCalledWith(url, {
                    headers: {
                        Authorization: expect.stringMatching(/^Basic /),
                    },
                });
                expect(aiService.getPlayersFromFile).toHaveBeenCalledOnce();
                expect(snapshot.content).toEqual('image-bytes');
                expect(snapshot.filePath.endsWith('.jpeg')).toBe(true);
                expect(dirname(snapshot.filePath).startsWith(join(tmpdir(), 'mms-'))).toBe(true);
                expect(existsSync(dirname(snapshot.filePath))).toBe(false);
            });

            it('should reply with each display name and its kill/death ratio', async () => {
                aiService.getPlayersFromFile.mockResolvedValue([' Player1 ', '', 'Player2']);
                destiny2Service.getPlayerStatistics
                    .mockResolvedValueOnce({ pvp: { kdr: '1.42' } })
                    .mockResolvedValueOnce({ pvp: { kdr: '0.87' } });
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1\n0.87 Player2',
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when consent is withdrawn while the image is being processed', () => {
            /**
             * Suppression is not "sendMessage was never called" any more - the
             * check moved inside it, so that the wait for a rate limiter slot
             * falls before the check rather than after it. What this layer can
             * assert is that a guard was handed over and that it withholds;
             * that no provider call follows is notification.service.spec.js's.
             */
            const guardFromLastSend = () => {
                const calls = notificationService.sendMessage.mock.calls;

                expect(calls).toHaveLength(1);

                return calls[0][3].guard;
            };

            beforeEach(() => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );
                /** Subscribed when the job starts, opted out by the time it replies. */
                userService.getConsentByPhoneNumber
                    .mockResolvedValueOnce({ isSubscribed: true })
                    .mockResolvedValue({ isSubscribed: false });
            });

            it('should withhold the roster reply', async () => {
                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).toHaveBeenCalled();
                await expect(guardFromLastSend()()).resolves.toBe(false);
            });

            it('should read the consent projection rather than the whole user', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });
                await guardFromLastSend()();

                expect(userService.getConsentByPhoneNumber).toHaveBeenCalledWith(from);
            });

            it('should withhold the failure reply too', async () => {
                aiService.getPlayersFromFile.mockRejectedValue(new Error('analysis failed'));

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
                await expect(guardFromLastSend()()).resolves.toBe(false);
            });

            it('should stop before processing any remaining attachments', async () => {
                await run({
                    from,
                    media: [
                        { contentType: 'image/jpeg', url },
                        { contentType: 'image/jpeg', url },
                    ],
                });

                expect(aiService.getPlayersFromFile).toHaveBeenCalledTimes(1);
            });

            /**
             * The image was acknowledged, so a store that cannot be read
             * must not end the job the way an opt-out does: the job is
             * retried, and nothing is sent until consent can be confirmed.
             */
            it('should leave the job to be retried when consent cannot be read before the reply', async () => {
                userService.getConsentByPhoneNumber
                    .mockReset()
                    .mockResolvedValueOnce({ isSubscribed: true })
                    .mockRejectedValue(new Error('Cosmos is down'));

                await expect(
                    run({ from, media: [{ contentType: 'image/jpeg', url }] }),
                ).rejects.toBeInstanceOf(ConsentUnavailableError);
                expect(notificationService.sendMessage).toHaveBeenCalledOnce();
                expect(notificationService.sendMessage).not.toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    expect.anything(),
                    expect.anything(),
                    expect.anything(),
                );
            });

            it('should leave the job to be retried when consent cannot be read at the start', async () => {
                userService.getConsentByPhoneNumber
                    .mockReset()
                    .mockRejectedValue(new Error('Cosmos is down'));

                await expect(
                    run({ from, media: [{ contentType: 'image/jpeg', url }] }),
                ).rejects.toBeInstanceOf(ConsentUnavailableError);
                expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });

        describe('when the download responds with an error status', () => {
            it('should skip analysis and send a failure reply to the sender', async () => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the media exceeds the maximum size', () => {
            it('should skip analysis and send a failure reply to the sender', async () => {
                vi.stubGlobal(
                    'fetch',
                    vi
                        .fn()
                        .mockResolvedValue(
                            new Response(Buffer.alloc(MAX_MEDIA_BYTES + 1), { status: 200 }),
                        ),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the media URL points somewhere other than Twilio', () => {
            it('should refuse to download and send a failure reply to the sender', async () => {
                const fetchMock = vi.fn();

                vi.stubGlobal('fetch', fetchMock);

                await run({
                    from,
                    media: [{ contentType: 'image/jpeg', url: 'https://evil.example.com/ME123' }],
                });

                expect(fetchMock).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the media URL is not HTTPS', () => {
            it('should refuse to download and send a failure reply to the sender', async () => {
                const fetchMock = vi.fn();

                vi.stubGlobal('fetch', fetchMock);

                await run({
                    from,
                    media: [{ contentType: 'image/jpeg', url: url.replace('https:', 'http:') }],
                });

                expect(fetchMock).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when analysis fails', () => {
            it('should still delete the temporary file and send a failure reply', async () => {
                let analyzedPath;

                aiService.getPlayersFromFile.mockImplementation(async filePath => {
                    analyzedPath = filePath;
                    throw new Error('analysis failed');
                });

                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).toHaveBeenCalledOnce();
                expect(existsSync(analyzedPath)).toBe(false);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when one ratio is wider than the others', () => {
            it('should right align them so every name starts at one column', async () => {
                aiService.getPlayersFromFile.mockResolvedValue([
                    'Lyn',
                    'WAREAGLE1123',
                    'lady_helz8',
                ]);
                destiny2Service.getPlayerStatistics
                    .mockResolvedValueOnce({ pvp: { kdr: '1.42' } })
                    .mockResolvedValueOnce({ pvp: { kdr: '10.53' } })
                    .mockResolvedValueOnce({ pvp: { kdr: null } });
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    [
                        '',
                        '',
                        ' 1.42 Lyn',
                        '10.53 WAREAGLE1123',
                        ` ${UNKNOWN_STATISTIC} lady_helz8`,
                    ].join('\n'),
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when a display name cannot be matched to exactly one player', () => {
            beforeEach(() => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1']);
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );
            });

            it.each([
                ['the search returns nobody', []],
                [
                    'every result is a prefix match rather than the name',
                    [playerMatching('Player1AndFriends')],
                ],
                [
                    'two players share the name',
                    [
                        playerMatching('Player1'),
                        playerMatching('Player1', { bungieGlobalDisplayNameCode: 5678 }),
                    ],
                ],
            ])('should list the player without a ratio when %s', async (_, searchResults) => {
                FakeDestiny2Service.findPlayers.mockResolvedValue(searchResults);

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(destiny2Service.getPlayerStatistics).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    `\n\n${UNKNOWN_STATISTIC} Player1`,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });

            it.each([['Player1#5678'], ['Player1 #5678'], ['Player1 # 5678']])(
                'should use the code in %s to pick between players sharing a name',
                async extractedName => {
                    aiService.getPlayersFromFile.mockResolvedValue([extractedName]);
                    FakeDestiny2Service.findPlayers.mockResolvedValue([
                        playerMatching('Player1'),
                        playerMatching('Player1', {
                            bungieGlobalDisplayNameCode: 5678,
                            destinyMemberships: [
                                {
                                    membershipId: '4611686019',
                                    membershipType: 2,
                                    displayName: 'Player1',
                                    crossSaveOverride: 0,
                                },
                            ],
                        }),
                    ]);

                    await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                    expect(FakeDestiny2Service.findPlayers).toHaveBeenCalledWith('Player1', 0);
                    expect(destiny2Service.getPlayerStatistics).toHaveBeenCalledWith(
                        '4611686019',
                        2,
                    );
                    expect(notificationService.sendMessage).toHaveBeenCalledWith(
                        `\n\n1.42 ${extractedName}`,
                        from,
                        undefined,
                        expect.objectContaining({ guard: expect.any(Function) }),
                    );
                },
            );
            it('should match a code that kept the leading zero the game shows', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1#0420']);
                FakeDestiny2Service.findPlayers.mockResolvedValue([
                    playerMatching('Player1', { bungieGlobalDisplayNameCode: 420 }),
                ]);

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(destiny2Service.getPlayerStatistics).toHaveBeenCalledWith('4611686018', 3);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1#0420',
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });

            it('should fall back to the name when the code is unreadable', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1#????']);
                FakeDestiny2Service.findPlayers.mockResolvedValue([playerMatching('Player1')]);

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1#????',
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when looking a player up fails', () => {
            it('should still reply with the rest of the roster', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1', 'Player2']);
                FakeDestiny2Service.findPlayers.mockImplementation(async name => {
                    if (name === 'Player1') throw new Error('bungie down');

                    return [playerMatching(name)];
                });
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    `\n\n${UNKNOWN_STATISTIC} Player1\n1.42 Player2`,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the image holds no recognizable display names', () => {
            it.each([
                ['an empty response', ['']],
                ['no response at all', undefined],
            ])('should say so rather than send an empty message given %s', async (_, players) => {
                aiService.getPlayersFromFile.mockResolvedValue(players);
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_NO_PLAYERS_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the roster screen is configured', () => {
            beforeEach(() => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );
            });

            it('should screen the downloaded image with its content type', async () => {
                aiService.getRosterProbability.mockResolvedValue(0.95);

                await run({ from, media: [{ contentType: 'image/png', url }] });

                expect(aiService.getRosterProbability).toHaveBeenCalledWith(
                    expect.stringMatching(/image\.png$/),
                    'image/png',
                );
                expect(aiService.getPlayersFromFile).toHaveBeenCalledOnce();
            });

            it.each([0.01, 0.2])(
                'should skip extraction and say no players were found at %s',
                async probability => {
                    aiService.getRosterProbability.mockResolvedValue(probability);

                    await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                    expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                    expect(FakeDestiny2Service.findPlayers).not.toHaveBeenCalled();
                    expect(notificationService.sendMessage).toHaveBeenCalledWith(
                        MEDIA_NO_PLAYERS_REPLY,
                        from,
                        undefined,
                        expect.objectContaining({ guard: expect.any(Function) }),
                    );
                },
            );

            it('should analyze the image anyway when the screen fails', async () => {
                aiService.getRosterProbability.mockRejectedValue(
                    Object.assign(new Error('Decisions request failed'), { status: 503 }),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).toHaveBeenCalledOnce();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1\n1.42 Player2',
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        describe('when the reply with the display names cannot be sent', () => {
            it('should fall back to the failure reply', async () => {
                notificationService.sendMessage.mockRejectedValueOnce(new Error('twilio down'));
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await run({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenLastCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
            });
        });

        /**
         * The suite runs without --permission, so nothing above would notice
         * production losing access to its temporary directory - which is how
         * every MMS download once failed with ERR_ACCESS_DENIED on /tmp, and
         * then leaked its directory when only the write half was granted.
         */
        describe('the temporary directory production downloads into', () => {
            const grantsIn = flag => {
                const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));

                return [...scripts['start:production'].matchAll(flag)].map(([, grant]) => grant);
            };
            const temporaryDirectory = () => {
                const [, directory] =
                    readFileSync('Dockerfile', 'utf8').match(/^ENV TMPDIR=(\S+)$/m) ?? [];

                return directory;
            };

            it.each([
                ['read', /--allow-fs-read=(\S+)/g],
                ['write', /--allow-fs-write=(\S+)/g],
            ])('should be covered by a %s grant in the production start script', (_, flag) => {
                const directory = temporaryDirectory();

                expect(directory).toBeDefined();
                expect(
                    grantsIn(flag).some(grant => join(directory, '/').startsWith(join(grant, '/'))),
                ).toBe(true);
            });
        });

        describe('when sending the failure reply itself fails', () => {
            it('should resolve without throwing', async () => {
                notificationService.sendMessage.mockRejectedValue(new Error('twilio down'));
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
                );

                await expect(
                    run({ from, media: [{ contentType: 'image/jpeg', url }] }),
                ).resolves.toBeUndefined();
            });
        });
    });

    describe('as the MMS queue worker', () => {
        const image = { contentType: 'image/jpeg', url };
        const keyOf = call => call[3].claimCheckNumber;

        beforeEach(() => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('image-bytes', { status: 200 })),
            );
        });

        it('should work the MMS queue a few jobs at a time, apologizing when it gives up', () => {
            expect(listen).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'mms', {
                concurrency: MMS_CONCURRENCY,
                onGiveUp: expect.any(Function),
            });
        });

        it('should queue a message through the MMS queue', async () => {
            const mms = { messageSid, from, media: [image] };

            await mmsService.enqueue(mms);

            expect(enqueueMms).toHaveBeenCalledExactlyOnceWith(mms);
        });

        it('should not process an image from a sender who has opted out since', async () => {
            userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: false });

            await run({ media: [image] });

            expect(fetch).not.toHaveBeenCalled();
            expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        it("should save each image's reply on the job before sending it", async () => {
            await run({ media: [image] });

            expect(job.updateData).toHaveBeenCalledExactlyOnceWith({
                body: '{}',
                progress: { replies: [expect.stringContaining('1.42 Player1')] },
            });
            expect(job.updateData.mock.invocationCallOrder[0]).toBeLessThan(
                notificationService.sendMessage.mock.invocationCallOrder[0],
            );
        });

        it('should not analyze an image again once its reply is saved', async () => {
            job = jobWith({ replies: ['\n\nsaved roster'] });

            await run({ media: [image] });

            expect(fetch).not.toHaveBeenCalled();
            expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
            expect(notificationService.sendMessage).toHaveBeenCalledExactlyOnceWith(
                '\n\nsaved roster',
                from,
                undefined,
                expect.objectContaining({ claimCheckNumber: `mms:${messageSid}:0` }),
            );
        });

        it('should key each reply by the message and the image, so a retry settles it', async () => {
            await run({ media: [image, { ...image, contentType: 'image/png' }] });

            expect(notificationService.sendMessage.mock.calls.map(keyOf)).toEqual([
                `mms:${messageSid}:0`,
                `mms:${messageSid}:1`,
            ]);
        });

        it('should resume after a retryable failure without analyzing the first image again', async () => {
            const media = [image, { ...image, contentType: 'image/png' }];

            notificationService.sendMessage
                .mockResolvedValueOnce(sentMessage)
                .mockRejectedValueOnce(new SendOutcomeUnknownError('Twilio may have it'));

            await expect(run({ media })).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            expect(aiService.getPlayersFromFile).toHaveBeenCalledTimes(2);

            await run({ media });

            expect(aiService.getPlayersFromFile).toHaveBeenCalledTimes(2);
            expect(notificationService.sendMessage.mock.calls.map(keyOf)).toEqual([
                `mms:${messageSid}:0`,
                `mms:${messageSid}:1`,
                `mms:${messageSid}:0`,
                `mms:${messageSid}:1`,
            ]);
        });

        it('should leave a failed progress save to BullMQ, sending no failure reply', async () => {
            job.updateData.mockRejectedValueOnce(new Error('Connection is closed.'));

            await expect(run({ media: [image] })).rejects.toBeInstanceOf(ProgressUnsavedError);
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        it('should leave a retryable failure to BullMQ, sending no failure reply', async () => {
            const unavailable = Object.assign(new Error('Service Unavailable'), { status: 503 });

            aiService.getPlayersFromFile.mockRejectedValue(unavailable);

            await expect(run({ media: [image] })).rejects.toBe(unavailable);
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        it('should send one failure reply, keyed to the message, for a permanent failure', async () => {
            aiService.getPlayersFromFile.mockRejectedValue(new Error('unreadable'));

            await run({ media: [image] });

            expect(notificationService.sendMessage).toHaveBeenCalledExactlyOnceWith(
                MEDIA_ERROR_REPLY,
                from,
                undefined,
                expect.objectContaining({ claimCheckNumber: `mms:${messageSid}:error` }),
            );
        });

        it('should send the same failure reply once BullMQ gives up', async () => {
            const [, , { onGiveUp }] = listen.mock.calls[0];

            await onGiveUp({ messageSid, from, media: [image] });

            expect(notificationService.sendMessage).toHaveBeenCalledExactlyOnceWith(
                MEDIA_ERROR_REPLY,
                from,
                undefined,
                expect.objectContaining({ claimCheckNumber: `mms:${messageSid}:error` }),
            );
        });

        it('should not reject when the failure reply cannot be sent after giving up', async () => {
            const [, , { onGiveUp }] = listen.mock.calls[0];

            notificationService.sendMessage.mockRejectedValue(new Error('twilio down'));

            await expect(onGiveUp({ messageSid, from, media: [image] })).resolves.toBeUndefined();
        });
    });
});
