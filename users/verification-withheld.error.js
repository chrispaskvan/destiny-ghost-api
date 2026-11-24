// @ts-check
/**
 * A verification message that was not sent because a limit on where it was
 * going was spent (see `helpers/verification-limits.js`).
 *
 * A distinct type so sign-up can tell a message it chose not to send from one
 * that failed: the limits have already logged why, and a withheld message is
 * not a delivery fault to raise an error for.
 */
class VerificationWithheldError extends Error {
    /**
     * @param {'phone' | 'email'} channel
     */
    constructor(channel) {
        super(`verification ${channel} message withheld`);

        this.name = 'VerificationWithheldError';
        this.channel = channel;
    }
}

export default VerificationWithheldError;
