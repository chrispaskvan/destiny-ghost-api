import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MmsService from './mms.service.js';
import { MAX_MEDIA_BYTES, MEDIA_ERROR_REPLY } from './twilio.constants.js';

const from = '+15005550006';
const url = 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123';
const notificationService = { sendMessage: vi.fn() };

let mmsService;

beforeEach(() => {
    vi.clearAllMocks();
    notificationService.sendMessage.mockResolvedValue(undefined);
    mmsService = new MmsService({ notificationService });
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
                const analyzeSpy = vi
                    .spyOn(MmsService, 'analyzeImage')
                    .mockImplementation(async filePath => {
                        snapshot = {
                            content: readFileSync(filePath, 'utf8'),
                            filePath,
                        };
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
                expect(analyzeSpy).toHaveBeenCalledOnce();
                expect(snapshot.content).toEqual('image-bytes');
                expect(snapshot.filePath.endsWith('.jpeg')).toBe(true);
                expect(dirname(snapshot.filePath).startsWith(join(tmpdir(), 'mms-'))).toBe(true);
                expect(existsSync(dirname(snapshot.filePath))).toBe(false);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });

        describe('when the download responds with an error status', () => {
            it('should skip analysis and send a failure reply to the sender', async () => {
                const analyzeSpy = vi.spyOn(MmsService, 'analyzeImage');

                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
                );

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(analyzeSpy).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                );
            });
        });

        describe('when the media exceeds the maximum size', () => {
            it('should skip analysis and send a failure reply to the sender', async () => {
                const analyzeSpy = vi.spyOn(MmsService, 'analyzeImage');

                vi.stubGlobal(
                    'fetch',
                    vi
                        .fn()
                        .mockResolvedValue(
                            new Response(Buffer.alloc(MAX_MEDIA_BYTES + 1), { status: 200 }),
                        ),
                );

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(analyzeSpy).not.toHaveBeenCalled();
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
                const analyzeSpy = vi
                    .spyOn(MmsService, 'analyzeImage')
                    .mockImplementation(async filePath => {
                        analyzedPath = filePath;
                        throw new Error('analysis failed');
                    });

                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 })),
                );

                await mmsService.process({ from, media: [{ contentType: 'image/jpeg', url }] });

                expect(analyzeSpy).toHaveBeenCalledOnce();
                expect(existsSync(analyzedPath)).toBe(false);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    MEDIA_ERROR_REPLY,
                    from,
                );
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
