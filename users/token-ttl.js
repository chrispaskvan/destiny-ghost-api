// @ts-check
/**
 * How long a verification token stays valid, in seconds.
 *
 * Fifteen minutes, so an emailed link survives greylisting, which can hold a
 * message for five to fifteen. `join` checks the SMS code and the email link
 * together against one timestamp, so one TTL covers both: a shorter one for
 * either channel would decide `join` on its own (#571).
 *
 * The longer window does not make the six-digit code guessable: `join` also
 * needs the 128-bit email token.
 * @type {number}
 */
const TOKEN_TTL_SECONDS = 900;

export default TOKEN_TTL_SECONDS;
