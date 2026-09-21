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
const userService = { getUserByPhoneNumber: vi.fn() };
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
    userService.getUserByPhoneNumber.mockResolvedValue({ phoneNumber: from, isSubscribed: true });
    mmsService = new MmsService({ aiService, destiny2Service, notificationService, userService });
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
                    '\n\n1.42 Player1\n0.87 Player2',
                    from,
                );
            });
        });

        describe('when consent is withdrawn while the image is being processed', () => {
            beforeEach(() => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );
            });

            it('should not reply with the roster', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    phoneNumber: from,
                    isSubscribed: false,
                });

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(aiService.getPlayersFromFile).toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should read consent through to Cosmos rather than the cache', async () => {
                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(userService.getUserByPhoneNumber).toHaveBeenCalledWith(from, true);
            });

            it('should not send the failure reply either', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    phoneNumber: from,
                    isSubscribed: false,
                });
                aiService.getPlayersFromFile.mockRejectedValue(new Error('analysis failed'));

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should stop before processing any remaining attachments', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    phoneNumber: from,
                    isSubscribed: false,
                });

                await mmsService.process({
                    from,
                    media: [
                        { contentType: 'image/jpeg', url },
                        { contentType: 'image/jpeg', url },
                    ],
                });

                expect(aiService.getPlayersFromFile).toHaveBeenCalledTimes(1);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should suppress when consent storage is unavailable', async () => {
                userService.getUserByPhoneNumber.mockRejectedValue(new Error('Cosmos is down'));

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
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

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    [
                        '',
                        '',
                        ' 1.42 Lyn',
                        '10.53 WAREAGLE1123',
                        ` ${UNKNOWN_STATISTIC} lady_helz8`,
                    ].join('\n'),
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
                    `\n\n${UNKNOWN_STATISTIC} Player1`,
                    from,
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

                    await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                    expect(FakeDestiny2Service.findPlayers).toHaveBeenCalledWith('Player1', 0);
                    expect(destiny2Service.getPlayerStatistics).toHaveBeenCalledWith(
                        '4611686019',
                        2,
                    );
                    expect(notificationService.sendMessage).toHaveBeenCalledWith(
                        `\n\n1.42 ${extractedName}`,
                        from,
                    );
                },
            );
            it('should match a code that kept the leading zero the game shows', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1#0420']);
                FakeDestiny2Service.findPlayers.mockResolvedValue([
                    playerMatching('Player1', { bungieGlobalDisplayNameCode: 420 }),
                ]);

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(destiny2Service.getPlayerStatistics).toHaveBeenCalledWith('4611686018', 3);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1#0420',
                    from,
                );
            });

            it('should fall back to the name when the code is unreadable', async () => {
                aiService.getPlayersFromFile.mockResolvedValue(['Player1#????']);
                FakeDestiny2Service.findPlayers.mockResolvedValue([playerMatching('Player1')]);

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '\n\n1.42 Player1#????',
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
                    `\n\n${UNKNOWN_STATISTIC} Player1\n1.42 Player2`,
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
