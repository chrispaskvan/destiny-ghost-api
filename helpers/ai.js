// @ts-check
import { GoogleGenAI } from '@google/genai';
import configuration from './config.js';
import log from './log.js';
import { withRetry, isTransientError } from './retry.js';

/**
 * How long any one call to the AI may take before it is abandoned. Retrying
 * cannot rescue a call that never settles, and a caller left waiting on one
 * holds whatever it was analyzing - so the ceiling has to come from here.
 * Generous on purpose: a busy model has answered in over a minute.
 */
const DEFAULT_TIMEOUT = 120000;

const {
    gemini: { apiKey, model, thinkingBudget, timeout = DEFAULT_TIMEOUT },
} = configuration;

/**
 * The SDK applies this per request, which is what is wanted: retry backoff
 * sleeps are not covered by it, so each attempt gets the full allowance.
 */
const httpOptions = { timeout };

/**
 * Thinking is left at the model's own default unless settings ask for a budget,
 * because setting the field at all is an error on models that do not support
 * thinking. Reading names off a screenshot is extraction rather than reasoning,
 * so a budget of 0 is the value worth trying first.
 */
const thinkingConfig = Number.isFinite(thinkingBudget) ? { thinkingBudget } : undefined;

class AI {
    // Static prompt constants that can be used in tests
    static prompts = {
        imageDescription:
            "The image is a list of players in a video game player versus player match. The player's display name is followed by the player's clan in square brackets.",
        extractionInstruction:
            'List the 12 display names in the image in the order they appear. Respond with a comma delimited string. Do not remove any whitespace between characters and do not add any spaces between commas.',
    };

    constructor() {
        this.ai = new GoogleGenAI({ apiKey });
    }

    /**
     * Delete the uploaded copy of a file.
     *
     * The caller's image is private to them, so the copy the Files API keeps
     * should not outlive the answer it was uploaded for. A delete that fails is
     * worth knowing about but must never replace the caller's own error, nor
     * turn a successful analysis into a failed one.
     *
     * @param {string} [name] - Resource name, e.g. `files/123-456`.
     * @returns {Promise<void>}
     */
    async #deleteFile(name) {
        if (!name) return;

        try {
            await this.ai.files.delete({ name, config: { httpOptions } });
        } catch (err) {
            log.warn({ err, name }, 'Failed to delete the uploaded file');
        }
    }

    /**
     * @param {string} path
     * @returns {Promise<string[] | undefined>} Display names, or undefined when
     * the model answers with no text at all.
     */
    async getPlayersFromFile(path) {
        const {
            mimeType,
            name,
            uri: fileUri,
        } = await withRetry(() => this.ai.files.upload({ file: path, config: { httpOptions } }), {
            shouldRetry: isTransientError,
        });

        log.info({ fileUri, mimeType, path }, 'File uploaded to the AI');

        const config = {
            httpOptions,
            responseMimeType: 'text/plain',
            ...(thinkingConfig && { thinkingConfig }),
        };
        const contents = [
            {
                role: 'user',
                parts: [
                    {
                        fileData: {
                            fileUri,
                            mimeType,
                        },
                    },
                    {
                        text: AI.prompts.imageDescription,
                    },
                ],
            },
            {
                role: 'user',
                parts: [
                    {
                        text: AI.prompts.extractionInstruction,
                    },
                ],
            },
        ];
        try {
            const result = await withRetry(
                async () => {
                    /**
                     * Timed per attempt, and reported whether the attempt
                     * answers or throws, so a model that is merely slow reads
                     * differently in the log from one that is stuck.
                     */
                    const startedAt = performance.now();

                    try {
                        return await this.ai.models.generateContent({
                            model,
                            config,
                            contents,
                        });
                    } finally {
                        log.info(
                            { durationMs: Math.round(performance.now() - startedAt), model },
                            'The AI finished with the image',
                        );
                    }
                },
                { shouldRetry: isTransientError },
            );

            return result?.text?.split(',');
        } finally {
            await this.#deleteFile(name);
        }
    }
}

const aiInstance = new AI();

export { aiInstance as default, AI };
