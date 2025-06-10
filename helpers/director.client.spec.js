import { beforeEach, describe, expect, it, vi } from 'vitest';
import DirectorClient from './director.client';

vi.mock('./request', () => ({
    post: vi.fn(),
}));

describe('DirectorClient', () => {
    const testDisplayName = 'TestPlayer#1234';
    const testCookies = {
        sessionId: 'test-session-123',
        bungie_auth: 'test-auth-token',
        csrf_token: 'test-csrf-456',
    };
    const expectedQuery = 'query FindPlayersHeroNameAndFriends($displayName: String!) { findPlayers(displayName: $displayName) { bungieGlobalDisplayName bungieGlobalDisplayNameCode destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } statistics { pvp { kdr highestLightLevel } } user { firstName lastName } } }';

    let directorClient;
    let mockPost;

    beforeEach(async () => {
        vi.clearAllMocks();

        const requestModule = await import('./request');

        mockPost = requestModule.post;
        directorClient = new DirectorClient();
    });

    describe('constructor', () => {
        it('should initialize with the correct GraphQL query', () => {
            expect(directorClient.query).toBe(expectedQuery);
        });
    });

    describe('findPlayers', () => {
        it('should successfully find players and return statistics', async () => {
            const mockResponseBody = {
                data: {
                    findPlayers: [
                        {
                            bungieGlobalDisplayName: 'TestPlayer',
                            bungieGlobalDisplayNameCode: '1234',
                            destinyMemberships: [
                                {
                                    crossSaveOverride: 0,
                                    membershipType: 3,
                                    membershipId: '12345678901234567',
                                    displayName: 'TestPlayer',
                                    bungieGlobalDisplayName: 'TestPlayer',
                                    bungieGlobalDisplayNameCode: '1234',
                                },
                            ],
                            statistics: {
                                pvp: {
                                    kdr: 1.5,
                                    highestLightLevel: 1800,
                                },
                            },
                            user: {
                                firstName: 'Test',
                                lastName: 'Player',
                            },
                        },
                    ],
                },
            };

            mockPost.mockResolvedValue(mockResponseBody);

            const result = await directorClient.findPlayers(testDisplayName, testCookies);

            expect(mockPost).toHaveBeenCalledWith({
                url: `${process.env.PROTOCOL}://api2.destiny-ghost.com/director`,
                headers: {
                    'Content-Type': 'application/json',
                    cookie: 'sessionId=test-session-123; bungie_auth=test-auth-token; csrf_token=test-csrf-456',
                },
                data: JSON.stringify({
                    query: expectedQuery,
                    variables: { displayName: testDisplayName },
                }),
                redirect: 'follow',
            });

            expect(result).toEqual({
                pvp: {
                    kdr: 1.5,
                    highestLightLevel: 1800,
                },
            });
        });

        it('should handle multiple players and return first player statistics', async () => {
            const mockResponseBody = {
                data: {
                    findPlayers: [
                        {
                            statistics: {
                                pvp: {
                                    kdr: 2.0,
                                    highestLightLevel: 1850,
                                },
                            },
                        },
                        {
                            statistics: {
                                pvp: {
                                    kdr: 1.2,
                                    highestLightLevel: 1750,
                                },
                            },
                        },
                    ],
                },
            };

            mockPost.mockResolvedValue(mockResponseBody);

            const result = await directorClient.findPlayers(testDisplayName, testCookies);

            expect(result).toEqual({
                pvp: {
                    kdr: 2.0,
                    highestLightLevel: 1850,
                },
            });
        });

        it('should handle empty findPlayers array', async () => {
            const mockResponseBody = {
                data: {
                    findPlayers: [],
                },
            };

            mockPost.mockResolvedValue(mockResponseBody);

            const result = await directorClient.findPlayers(testDisplayName, testCookies);

            expect(result).toBeUndefined();
        });

        it('should handle null/undefined findPlayers', async () => {
            const mockResponseBody = {
                data: {
                    findPlayers: null,
                },
            };

            mockPost.mockResolvedValue(mockResponseBody);

            const result = await directorClient.findPlayers(testDisplayName, testCookies);

            expect(result).toBeUndefined();
        });

        it('should handle player without statistics', async () => {
            const mockResponseBody = {
                data: {
                    findPlayers: [
                        {
                            bungieGlobalDisplayName: 'TestPlayer',
                            statistics: undefined,
                        },
                    ],
                },
            };

            mockPost.mockResolvedValue(mockResponseBody);

            const result = await directorClient.findPlayers(testDisplayName, testCookies);

            expect(result).toBeUndefined();
        });

        it('should properly format cookies header', async () => {
            const complexCookies = {
                'session-id': 'complex-session-123',
                'special_cookie': 'value-with-dashes',
                'another.cookie': 'dot.separated.value',
            };
            const mockResponseBody = { data: { findPlayers: [] } };

            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(testDisplayName, complexCookies);

            expect(mockPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({
                        cookie: 'session-id=complex-session-123; special_cookie=value-with-dashes; another.cookie=dot.separated.value',
                    }),
                })
            );
        });

        it('should handle empty cookies object', async () => {
            const emptyCookies = {};
            const mockResponseBody = { data: { findPlayers: [] } };

            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(testDisplayName, emptyCookies);

            expect(mockPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({
                        cookie: '',
                    }),
                })
            );
        });

        it('should handle single cookie', async () => {
            const singleCookie = { token: 'single-value' };
            const mockResponseBody = { data: { findPlayers: [] } };

            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(testDisplayName, singleCookie);

            expect(mockPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({
                        cookie: 'token=single-value',
                    }),
                })
            );
        });

        it('should handle network errors', async () => {
            const networkError = new Error('Network connection failed');

            mockPost.mockRejectedValue(networkError);

            await expect(directorClient.findPlayers(testDisplayName, testCookies)).rejects.toThrow('Network connection failed');
        });

        it('should handle GraphQL errors in response', async () => {
            const errorResponse = {
                errors: [
                    {
                        message: 'Player not found',
                        extensions: { code: 'NOT_FOUND' },
                    },
                ],
                data: null,
            };

            mockPost.mockResolvedValue(errorResponse);

            await expect(directorClient.findPlayers(testDisplayName, testCookies)).rejects.toThrow();
        });

        it('should handle malformed response', async () => {
            const malformedResponse = {
                result: 'unexpected structure',
            };

            mockPost.mockResolvedValue(malformedResponse);

            await expect(directorClient.findPlayers(testDisplayName, testCookies)).rejects.toThrow();
        });

        it('should use correct environment protocol', async () => {
            const mockResponseBody = { data: { findPlayers: [] } };
            const originalProtocol = process.env.PROTOCOL;

            process.env.PROTOCOL = 'https';
            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(testDisplayName, testCookies);

            expect(mockPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://api2.destiny-ghost.com/director',
                })
            );

            process.env.PROTOCOL = originalProtocol;
        });

        it('should include all required request properties', async () => {
            const mockResponseBody = { data: { findPlayers: [] } };

            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(testDisplayName, testCookies);

            expect(mockPost).toHaveBeenCalledWith({
                url: expect.stringContaining('api2.destiny-ghost.com/director'),
                headers: {
                    'Content-Type': 'application/json',
                    cookie: expect.any(String),
                },
                data: expect.stringContaining(testDisplayName),
                redirect: 'follow',
            });
        });

        it('should properly serialize GraphQL variables', async () => {
            const specialDisplayName = 'Player with spaces#1234';
            const mockResponseBody = { data: { findPlayers: [] } };

            mockPost.mockResolvedValue(mockResponseBody);

            await directorClient.findPlayers(specialDisplayName, testCookies);

            const callArgs = mockPost.mock.calls[0][0];
            const parsedData = JSON.parse(callArgs.data);

            expect(parsedData.variables.displayName).toBe(specialDisplayName);
            expect(parsedData.query).toBe(expectedQuery);
        });
    });
});
