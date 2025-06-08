import { GoogleGenAI } from '@google/genai';
import configuration from './config';
import log from './log';

const { gemini: { apiKey, model } } = configuration;

class AI {
    constructor() {
        this.ai = new GoogleGenAI({ apiKey });
    }

    async getPlayersFromFile(path) {
        const { mimeType, uri: fileUri } = await ai.files.upload({ file: path });

        log.info({ fileUri, mimeType, path }, 'File uploaded to the AI');

        const config = {
            responseMimeType: 'text/plain',
        };
        const contents = [
            {
                role: 'user',
                parts: [
                    {
                        fileData: {
                            fileUri,
                            mimeType,
                        }
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
        ];
        const result = await ai.models.generateContent({
            model,
            config,
            contents,
        });

        return result?.text.split(',');
    }
}

const aiInstance = new AI();

export default aiInstance;
