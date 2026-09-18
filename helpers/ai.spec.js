import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import aiInstance from './ai.js';
import { withRetry, isTransientError } from './retry.js';

vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        files = { delete: vi.fn(), upload: vi.fn() };
        models = { generateContent: vi.fn() };
    },
}));
vi.mock('./config.js', () => ({
    default: {
        gemini: {
            apiKey: 'test-api-key',
            model: 'test-model',
        },
    },
}));
vi.mock('./log.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
    },
}));
vi.mock('./retry.js', () => ({
    withRetry: vi.fn(fn => fn()),
    isTransientError: vi.fn(),
}));

describe('AI', () => {
    const testFilePath = '/path/to/test/image.png';
    const testMimeType = 'image/png';
    const testFileUri = 'gs://test-bucket/test-file-uri';
    const testFileName = 'files/test-file-name';
    const testPlayerNames =
        'Player1,Player2,Player3,Player4,Player5,Player6,Player7,Player8,Player9,Player10,Player11,Player12';

    let mockDelete;
    let mockUpload;
    let mockGenerateContent;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDelete = aiInstance.ai.files.delete;
        mockUpload = aiInstance.ai.files.upload;
        mockGenerateContent = aiInstance.ai.models.generateContent;
        mockDelete.mockResolvedValue(undefined);
    });

    describe('constructor', () => {
        it('should have a GoogleGenAI instance', () => {
            expect(aiInstance.ai).toBeDefined();
        });
    });

    describe('getPlayersFromFile', () => {
        it('should wrap file upload and content generation with retry', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: testPlayerNames,
            });

            await aiInstance.getPlayersFromFile(testFilePath);

            expect(withRetry).toHaveBeenCalledTimes(2);
            expect(withRetry).toHaveBeenCalledWith(expect.any(Function), {
                shouldRetry: isTransientError,
            });
        });

        it('should successfully extract player names from uploaded file', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: testPlayerNames,
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(mockUpload).toHaveBeenCalledWith({
                file: testFilePath,
                config: { httpOptions: { timeout: expect.any(Number) } },
            });
            expect(mockGenerateContent).toHaveBeenCalledWith({
                model: 'test-model',
                config: {
                    httpOptions: { timeout: expect.any(Number) },
                    responseMimeType: 'text/plain',
                },
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                fileData: {
                                    fileUri: testFileUri,
                                    mimeType: testMimeType,
                                },
                            },
                            {
                                text: "The image is a list of players in a video game player versus player match. The player's display name is followed by the player's clan in square brackets.",
                            },
                        ],
                    },
                    {
                        role: 'user',
                        parts: [
                            {
                                text: 'List the 12 display names in the image in the order they appear. Respond with a comma delimited string. Do not remove any whitespace between characters and do not add any spaces between commas.',
                            },
                        ],
                    },
                ],
            });

            expect(result).toEqual([
                'Player1',
                'Player2',
                'Player3',
                'Player4',
                'Player5',
                'Player6',
                'Player7',
                'Player8',
                'Player9',
                'Player10',
                'Player11',
                'Player12',
            ]);
        });

        it('should handle player names with special characters and spaces', async () => {
            const specialPlayerNames =
                'Player One,Player-Two,Player_Three,[CLAN]Player4,Player 5 With Spaces,Player#Six';

            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: specialPlayerNames,
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toEqual([
                'Player One',
                'Player-Two',
                'Player_Three',
                '[CLAN]Player4',
                'Player 5 With Spaces',
                'Player#Six',
            ]);
        });

        it('should handle empty response from AI', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: '',
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toEqual(['']);
        });

        it('should handle undefined response from AI', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue(undefined);

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toBeUndefined();
        });

        it('should handle undefined text in AI response', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({});

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toBeUndefined();
        });

        it('should handle file upload failure', async () => {
            const uploadError = new Error('File upload failed');

            mockUpload.mockRejectedValue(uploadError);

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow(
                'File upload failed',
            );
            expect(mockGenerateContent).not.toHaveBeenCalled();
        });

        it('should handle AI content generation failure', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });

            const generationError = new Error('Content generation failed');

            mockGenerateContent.mockRejectedValue(generationError);

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow(
                'Content generation failed',
            );
        });

        it('should log file upload information', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: testPlayerNames,
            });

            const log = (await import('./log')).default;

            await aiInstance.getPlayersFromFile(testFilePath);

            expect(log.info).toHaveBeenCalledWith(
                {
                    fileUri: testFileUri,
                    mimeType: testMimeType,
                    path: testFilePath,
                },
                'File uploaded to the AI',
            );
        });

        it('should delete the uploaded file once it has an answer', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                name: testFileName,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({ text: testPlayerNames });

            await aiInstance.getPlayersFromFile(testFilePath);

            expect(mockDelete).toHaveBeenCalledWith({
                name: testFileName,
                config: { httpOptions: { timeout: expect.any(Number) } },
            });
        });

        it('should delete the uploaded file even when generation fails', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                name: testFileName,
                uri: testFileUri,
            });
            mockGenerateContent.mockRejectedValue(new Error('Content generation failed'));

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow(
                'Content generation failed',
            );
            expect(mockDelete).toHaveBeenCalledWith({
                name: testFileName,
                config: { httpOptions: { timeout: expect.any(Number) } },
            });
        });

        it('should keep the answer when the delete fails', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                name: testFileName,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({ text: 'Player1,Player2' });
            mockDelete.mockRejectedValue(new Error('delete failed'));

            const log = (await import('./log')).default;

            await expect(aiInstance.getPlayersFromFile(testFilePath)).resolves.toEqual([
                'Player1',
                'Player2',
            ]);
            expect(log.warn).toHaveBeenCalledWith(
                { err: expect.any(Error), name: testFileName },
                'Failed to delete the uploaded file',
            );
        });

        it('should not attempt a delete when the upload named no file', async () => {
            mockUpload.mockResolvedValue({ mimeType: testMimeType, uri: testFileUri });
            mockGenerateContent.mockResolvedValue({ text: testPlayerNames });

            await aiInstance.getPlayersFromFile(testFilePath);

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should report how long the model took, on success and on failure', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                name: testFileName,
                uri: testFileUri,
            });

            const log = (await import('./log')).default;

            mockGenerateContent.mockResolvedValue({ text: testPlayerNames });
            await aiInstance.getPlayersFromFile(testFilePath);

            expect(log.info).toHaveBeenCalledWith(
                { durationMs: expect.any(Number), model: 'test-model' },
                'The AI finished with the image',
            );

            vi.clearAllMocks();
            mockDelete.mockResolvedValue(undefined);
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                name: testFileName,
                uri: testFileUri,
            });
            mockGenerateContent.mockRejectedValue(new Error('Content generation failed'));

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow();
            expect(log.info).toHaveBeenCalledWith(
                { durationMs: expect.any(Number), model: 'test-model' },
                'The AI finished with the image',
            );
        });

        describe('when settings configure a thinking budget and a timeout', () => {
            afterEach(() => {
                vi.doUnmock('./config.js');
                vi.resetModules();
            });

            it('should pass both to the model', async () => {
                vi.resetModules();
                vi.doMock('./config.js', () => ({
                    default: {
                        gemini: {
                            apiKey: 'test-api-key',
                            model: 'test-model',
                            thinkingBudget: 0,
                            timeout: 5000,
                        },
                    },
                }));

                const { default: configuredAi } = await import('./ai.js');

                configuredAi.ai.files.delete.mockResolvedValue(undefined);
                configuredAi.ai.files.upload.mockResolvedValue({
                    mimeType: testMimeType,
                    name: testFileName,
                    uri: testFileUri,
                });
                configuredAi.ai.models.generateContent.mockResolvedValue({ text: 'Player1' });

                await configuredAi.getPlayersFromFile(testFilePath);

                expect(configuredAi.ai.models.generateContent).toHaveBeenCalledWith(
                    expect.objectContaining({
                        config: {
                            httpOptions: { timeout: 5000 },
                            responseMimeType: 'text/plain',
                            thinkingConfig: { thinkingBudget: 0 },
                        },
                    }),
                );
            });
        });

        it('should handle different file types', async () => {
            const jpegFilePath = '/path/to/test/image.jpg';
            const jpegMimeType = 'image/jpeg';

            mockUpload.mockResolvedValue({
                mimeType: jpegMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: testPlayerNames,
            });

            const result = await aiInstance.getPlayersFromFile(jpegFilePath);

            expect(mockUpload).toHaveBeenCalledWith({
                file: jpegFilePath,
                config: { httpOptions: { timeout: expect.any(Number) } },
            });
            expect(mockGenerateContent).toHaveBeenCalledWith(
                expect.objectContaining({
                    contents: expect.arrayContaining([
                        expect.objectContaining({
                            parts: expect.arrayContaining([
                                expect.objectContaining({
                                    fileData: {
                                        fileUri: testFileUri,
                                        mimeType: jpegMimeType,
                                    },
                                }),
                            ]),
                        }),
                    ]),
                }),
            );
            expect(result).toEqual(testPlayerNames.split(','));
        });

        it('should handle single player name response', async () => {
            const singlePlayerName = 'SinglePlayer';

            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: singlePlayerName,
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toEqual(['SinglePlayer']);
        });

        it('should handle response with trailing/leading commas', async () => {
            const playersWithExtraCommas = ',Player1,Player2,Player3,';

            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: playersWithExtraCommas,
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(result).toEqual(['', 'Player1', 'Player2', 'Player3', '']);
        });
    });

    describe('singleton behavior', () => {
        it('should export a singleton instance', () => {
            expect(aiInstance.ai).toBeDefined();
            expect(typeof aiInstance.getPlayersFromFile).toBe('function');
        });
    });
});
