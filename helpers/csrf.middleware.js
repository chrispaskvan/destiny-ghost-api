import { csrfSync } from 'csrf-sync';

/**
 * Synchronizer-token CSRF protection. Tokens are stored on `req.session.csrfToken`
 * (express-session already carries server-side state) and must be echoed back by
 * the client via the `x-csrf-token` header on state-changing requests.
 */
const { csrfSynchronisedProtection, generateToken } = csrfSync();

export { generateToken };
export default csrfSynchronisedProtection;
