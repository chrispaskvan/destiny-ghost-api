import { beforeEach, describe, expect, it, vi } from 'vitest';
import aiInstance from './ai';

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(() => ({
        files: {
            upload: vi.fn(),
        },
        models: {
            generateContent: vi.fn(),
        },
    })),
}));
vi.mock('./config', () => ({
    default: {
        gemini: {
            apiKey: 'test-api-key',
            model: 'test-model',
        },
    },
}));
vi.mock('./log', () => ({
    default: {
        info: vi.fn(),
    },
}));

describe('AI', () => {
    const testFilePath = '/path/to/test/image.png';
    const testMimeType = 'image/png';
    const testFileUri = 'gs://test-bucket/test-file-uri';
    const testPlayerNames = 'Player1,Player2,Player3,Player4,Player5,Player6,Player7,Player8,Player9,Player10,Player11,Player12';

    let mockUpload;
    let mockGenerateContent;

    beforeEach(() => {
        vi.clearAllMocks();

        mockUpload = aiInstance.ai.files.upload;
        mockGenerateContent = aiInstance.ai.models.generateContent;
    });

    describe('constructor', () => {
        it('should have a GoogleGenAI instance', () => {
            expect(aiInstance.ai).toBeDefined();
        });
    });

    describe('getPlayersFromFile', () => {
        it('should successfully extract player names from uploaded file', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });
            mockGenerateContent.mockResolvedValue({
                text: testPlayerNames,
            });

            const result = await aiInstance.getPlayersFromFile(testFilePath);

            expect(mockUpload).toHaveBeenCalledWith({ file: testFilePath });
            expect(mockGenerateContent).toHaveBeenCalledWith({
                model: 'test-model',
                config: {
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
                                text: 'The image is a list of players in a video game player versus player match. The player\'s display name is followed by the player\'s clan in square brackets.',
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
                'Player1', 'Player2', 'Player3', 'Player4', 'Player5', 'Player6',
                'Player7', 'Player8', 'Player9', 'Player10', 'Player11', 'Player12'
            ]);
        });

        it('should handle player names with special characters and spaces', async () => {
            const specialPlayerNames = 'Player One,Player-Two,Player_Three,[CLAN]Player4,Player 5 With Spaces,Player#Six';

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
                'Player#Six'
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

        it('should handle file upload failure', async () => {
            const uploadError = new Error('File upload failed');

            mockUpload.mockRejectedValue(uploadError);

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow('File upload failed');
            expect(mockGenerateContent).not.toHaveBeenCalled();
        });

        it('should handle AI content generation failure', async () => {
            mockUpload.mockResolvedValue({
                mimeType: testMimeType,
                uri: testFileUri,
            });

            const generationError = new Error('Content generation failed');

            mockGenerateContent.mockRejectedValue(generationError);

            await expect(aiInstance.getPlayersFromFile(testFilePath)).rejects.toThrow('Content generation failed');
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

            expect(log.info).toHaveBeenCalledWith({
                fileUri: testFileUri,
                mimeType: testMimeType,
                path: testFilePath,
            },
            'File uploaded to the AI'
            );
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

            expect(mockUpload).toHaveBeenCalledWith({ file: jpegFilePath });
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
                })
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
