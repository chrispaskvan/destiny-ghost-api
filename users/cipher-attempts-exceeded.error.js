// @ts-check
/**
 * A verification code whose attempts are spent. Every further attempt on it,
 * right or wrong, is refused until the user asks for a new code.
 *
 * A distinct type so the cryptarch route can answer it with 429 and tell the
 * user to request a new code, rather than the 404 a wrong code gets.
 */
class CipherAttemptsExceededError extends Error {
    constructor() {
        super('verification code attempts exceeded');

        this.name = 'CipherAttemptsExceededError';
    }
}

export default CipherAttemptsExceededError;
