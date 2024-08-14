import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import RedisErrors from 'redis-errors';
import DestinyCache from './destiny.cache';
import mockManifestResponse from '../mocks/manifestResponse.json';
import mockXurResponse from '../mocks/xurResponse.json';

let destinyCache;

const client = {
    get: vi.fn(),
    set: vi.fn(),
    ttl: vi.fn(),
};

beforeEach(() => {
    destinyCache = new DestinyCache({ client });
});

describe('DestinyCache', () => {
    describe('secondsUntilDailyReset', () => {
        let currentDate;
        let realDate;

        beforeEach(() => {
            realDate = Date;
            global.Date = class extends Date {
                constructor(date) {
                    if (date) {
                         
                        return super(date);
                    }

                     
                    return currentDate;
                }
            };
        });
        afterEach(() => {
            global.Date = realDate;
        });
        describe('when the current date and time is after the reset', () => {
            it('time to reset tomorrow', () => {
                currentDate = new Date('2020-04-25T18:00:00.000Z');

                const resetIn = DestinyCache.secondsUntilDailyReset();

                expect(resetIn).toEqual(82800); // 23 hours
            });
        });
        describe('when the current date and time is before the reset', () => {
            it('time to reset today', () => {
                currentDate = new Date('2020-04-25T16:00:00.000Z');

                const resetIn = DestinyCache.secondsUntilDailyReset();

                expect(resetIn).toEqual(3600); // 1 hour
            });
        });
    });

    describe('getManifest', () => {
        describe('when manifest is found', () => {
            it('should return manifest data and meta', async () => {
                const lastModified = new Date().toISOString();
                const ttl = 11;

                client.get.mockResolvedValueOnce(JSON.stringify({
                    manifest: mockManifestResponse.Response,
                    lastModified,
                }));
                client.ttl.mockResolvedValueOnce(ttl);

                const result = await destinyCache.getManifest();

                expect(result).toEqual({
                    data: {
                        manifest: mockManifestResponse.Response,
                    },
                    meta: {
                        lastModified,
                        maxAge: ttl,
                    },
                });
            });
        });

        describe('when a Redis error occurs', () => {
            it('should return undefined', async () => {
                client.get.mockRejectedValueOnce(new RedisErrors.RedisError());

                const result = await destinyCache.getManifest();

                expect(result).toBeUndefined();
            });
        });

        describe('when a different error occurs', () => {
            it('should throw', async () => {
                client.get.mockRejectedValueOnce(new Error());

                await expect(destinyCache.getManifest()).rejects.toThrow(Error);
            });
        });
    });

    describe('getVendor', () => {
        describe('when manifest is found', () => {
            it('should return manifest data and meta', async () => {
                client.get.mockResolvedValueOnce(JSON.stringify(mockXurResponse.Response));

                const result = await destinyCache.getVendor();

                expect(result).toEqual(mockXurResponse.Response);
            });
        });

        describe('when a Redis error occurs', () => {
            it('should return undefined', async () => {
                client.get.mockRejectedValueOnce(new RedisErrors.RedisError());

                const result = await destinyCache.getVendor();

                expect(result).toBeUndefined();
            });
        });

        describe('when a different error occurs', () => {
            it('should throw', async () => {
                client.get.mockRejectedValueOnce(new Error());

                await expect(destinyCache.getVendor()).rejects.toThrow(Error);
            });
        });
    });

    describe('setManifest', () => {
        const lastModified = new Date().toISOString();
        const ttl = 11;

        describe('when given a manifest', () => {
            it('should cache the manifest', async () => {
                client.set.mockResolvedValueOnce();

                const result = await destinyCache.setManifest({
                    lastModified,
                    manifest: mockManifestResponse.Response,
                    maxAge: ttl,
                });

                expect(client.set).toHaveBeenCalledOnce();
                expect(client.set).toBeCalledWith(
                     
                    destinyCache._manifestKey,
                    JSON.stringify({ lastModified, manifest: mockManifestResponse.Response }),
                    'EX',
                    ttl,
                );
                expect(result).toBeUndefined();
            });
        });

        describe('when a Redis error occurs', () => {
            it('should return a string', async () => {
                client.set.mockRejectedValueOnce(new RedisErrors.RedisError());

                const result = await destinyCache.setManifest({
                    lastModified,
                    manifest: mockManifestResponse.Response,
                    maxAge: ttl,
                });

                expect(result).toEqual('Error');
            });
        });

        describe('when a different error occurs', () => {
            it('should throw', async () => {
                client.set.mockRejectedValueOnce(new Error());

                await expect(destinyCache.setManifest({
                    lastModified,
                    manifest: mockManifestResponse.Response,
                    maxAge: ttl,
                })).rejects.toThrow(Error);
            });
        });

        describe('when the given manifest is undefined or not an object', () => {
            it('should throw an error', async () => {
                await expect(destinyCache.setManifest([])).rejects.toThrow(Error);
            });
        });

        afterEach(() => vi.clearAllMocks());
    });

    describe('setVendor', () => {
        const hash = 11;

        describe('when the given hash is a number', () => {
            it('should cache the vendor', async () => {
                client.set.mockResolvedValueOnce();

                const result = await destinyCache.setVendor(hash, mockXurResponse.Response);

                expect(client.set).toHaveBeenCalledOnce();
                expect(client.set).toBeCalledWith(
                    hash,
                    JSON.stringify(mockXurResponse.Response),
                    'EX',
                    expect.any(Number),
                );
                expect(result).toBeUndefined();
            });
        });

        describe('when a Redis error occurs', () => {
            it('should return a string', async () => {
                client.set.mockRejectedValueOnce(new RedisErrors.RedisError());

                const result = await destinyCache.setVendor(hash, mockXurResponse.Response);

                expect(result).toEqual('Error');
            });
        });

        describe('when a different error occurs', () => {
            it('should throw', async () => {
                client.set.mockRejectedValueOnce(new Error());

                await expect(destinyCache.setVendor(hash, mockXurResponse.Response))
                    .rejects.toThrow(Error);
            });
        });

        describe('when the given hash is not a number', () => {
            it('should throw an error', async () => {
                await expect(destinyCache.setVendor('Xur')).rejects.toThrow(Error);
            });
        });

        afterEach(() => vi.clearAllMocks());
    });
});
