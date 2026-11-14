// @ts-check
import { readFile } from 'node:fs/promises';

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

/**
 * How long the roster screen may take. The model answers in a few hundred
 * milliseconds, and the screen is only an optimization - a call that runs long
 * is abandoned and the image goes on to extraction as if it had never run.
 */
const DEFAULT_DECISION_TIMEOUT = 10000;

/**
 * Called directly rather than through the SDK: `decisions` first appears in
 * `@google/genai` 3.2, a major version past the one the upload and extraction
 * calls are written against, and this is one POST.
 */
const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';

const {
    gemini: {
        apiKey,
        decisionModel,
        decisionTimeout = DEFAULT_DECISION_TIMEOUT,
        model,
        thinkingBudget,
        timeout = DEFAULT_TIMEOUT,
    },
} = configuration;

/**
 * Given to the client rather than to each call. The SDK merges client options
 * into every request (ApiClient.patchHttpOptions), so the ceiling still reaches
 * all three - and files.upload is the reason it has to be done this way:
 * ApiClient.fetchUploadUrl *replaces* its own options with whatever a call
 * passes, discarding the empty apiVersion and the X-Goog-Upload-* headers a
 * resumable upload needs, which fails the upload with a 404.
 *
 * Per request is still the granularity that applies: retry backoff sleeps fall
 * outside it, so each attempt gets the full allowance.
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
        rosterQuestion:
            'Is this image a screenshot of a Destiny 2 player versus player match roster, listing the display names of the players in the match?',
        rosterTrue:
            'A screenshot or photo of a game screen listing the players in a PvP match by display name.',
        rosterFalse:
            'Anything else: a photo of people or places, a meme, a different game screen, or an image with no readable list of player names.',
    };

    constructor() {
        this.ai = new GoogleGenAI({ apiKey, httpOptions });
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
            await this.ai.files.delete({ name });
        } catch (err) {
            log.warn({ err, name }, 'Failed to delete the uploaded file');
        }
    }

    /**
     * Ask the decision model whether an image is a PvP roster at all, before
     * the slower extraction call is spent on it.
     *
     * Off unless settings name a `decisionModel`. The image goes inline rather
     * than through the Files API: it is already capped at the MMS size limit,
     * and inline leaves no uploaded copy to delete. Low resolution is enough to
     * tell a roster from a selfie and keeps the token count down.
     *
     * Not retried. The caller treats any failure as "unknown" and carries on,
     * so a retry would only add latency to a request that loses nothing
     * without it.
     *
     * @param {string} path - Path to the downloaded image.
     * @param {string} mimeType - e.g. `image/jpeg`.
     * @returns {Promise<number | undefined>} Calibrated probability, in
     * `[0.01, 0.99]`, that the image is a roster - or undefined when the
     * screen is not configured.
     */
    async getRosterProbability(path, mimeType) {
        if (!decisionModel) return undefined;

        const data = (await readFile(path)).toString('base64');
        const startedAt = performance.now();
        const response = await fetch(DECISIONS_URL, {
            body: JSON.stringify({
                model: decisionModel,
                input: [{ type: 'image', data, mime_type: mimeType, resolution: 'low' }],
                questions: {
                    is_roster: {
                        type: 'noul',
                        instructions: AI.prompts.rosterQuestion,
                        criteria: {
                            true_description: AI.prompts.rosterTrue,
                            false_description: AI.prompts.rosterFalse,
                        },
                    },
                },
            }),
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            method: 'POST',
            signal: AbortSignal.timeout(decisionTimeout),
        });

        if (!response.ok) {
            throw Object.assign(new Error('Decisions request failed'), {
                status: response.status,
            });
        }

        const {
            answers: {
                is_roster: { confidence, noul },
            },
        } = /** @type {{ answers: { is_roster: { confidence: number, noul: number } } }} */ (
            await response.json()
        );

        log.info(
            {
                confidence,
                durationMs: Math.round(performance.now() - startedAt),
                model: decisionModel,
                noul,
            },
            'The AI screened the image',
        );

        // Anything but a probability would read as "not a roster" to the
        // caller's threshold check, so it is thrown instead, failing open.
        if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
            throw new TypeError(`Decisions returned an invalid probability: ${noul}`);
        }

        return noul;
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
        } = await withRetry(() => this.ai.files.upload({ file: path }), {
            shouldRetry: isTransientError,
        });

        log.info({ fileUri, mimeType, path }, 'File uploaded to the AI');

        const config = {
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
