import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MmsService from './mms.service.js';
import {
    MAX_MEDIA_BYTES,
    MEDIA_ERROR_REPLY,
    MEDIA_NO_PLAYERS_REPLY,
    UNKNOWN_STATISTIC,
} from './twilio.constants.js';

const from = '+15005550006';
const url = 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123';
const aiService = { getPlayersFromFile: vi.fn() };

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

beforeEach(() => {
    vi.clearAllMocks();
    aiService.getPlayersFromFile.mockResolvedValue(['Player1', 'Player2']);
    FakeDestiny2Service.findPlayers.mockImplementation(async name => [playerMatching(name)]);
    destiny2Service.getPlayerStatistics.mockResolvedValue({ pvp: { kdr: '1.42' } });
    notificationService.sendMessage.mockResolvedValue(undefined);
    mmsService = new MmsService({ aiService, destiny2Service, notificationService });
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Player1 1.42\nPlayer2 0.87',
                    from,
                );
            });
        });

        describe('when the download responds with an error status', () => {
            it('should skip analysis and send a failure reply to the sender', async () => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
                );

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                );
            });
        });

        describe('when the media URL points somewhere other than Twilio', () => {
            it('should refuse to download and send a failure reply to the sender', async () => {
                const fetchMock = vi.fn();

                vi.stubGlobal('fetch', fetchMock);

                await mmsService.process({
                    from,
                    media: [{ contentType: 'image/jpeg', url: 'https://evil.example.com/ME123' }],
                });

                expect(fetchMock).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                );
            });
        });

        describe('when the media URL is not HTTPS', () => {
            it('should refuse to download and send a failure reply to the sender', async () => {
                const fetchMock = vi.fn();

                vi.stubGlobal('fetch', fetchMock);

                await mmsService.process({
                    from,
                    media: [{ contentType: 'image/jpeg', url: url.replace('https:', 'http:') }],
                });

                expect(fetchMock).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).toHaveBeenCalledOnce();
                expect(existsSync(analyzedPath)).toBe(false);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(destiny2Service.getPlayerStatistics).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    `Player1 ${UNKNOWN_STATISTIC}`,
                    from,
                );
            });

            it('should use the code to pick between players sharing a name', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1#5678']);
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(FakeDestiny2Service.findPlayers).toHaveBeenCalledWith('Player1', 0);
                expect(destiny2Service.getPlayerStatistics).toHaveBeenCalledWith('4611686019', 2);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Player1#5678 1.42',
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    `Player1 ${UNKNOWN_STATISTIC}\nPlayer2 1.42`,
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_NO_PLAYERS_REPLY,
                    from,
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenLastCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
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
                    mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] }),
                ).resolves.toBeUndefined();
            });
        });
    });
});
