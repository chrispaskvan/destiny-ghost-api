/**
 * A module for keeping credentials out of logs.
 *
 * @module redact
 * @summary Central, defense-in-depth redaction for Pino.
 * @author Chris Paskvan
 */
// @ts-check

/**
 * What a redacted value is replaced with. Distinct from an absent field on
 * purpose: seeing that a request carried an `authorization` header is useful,
 * and seeing its value is not.
 * @type {string}
 */
const censor = '[Redacted]';

/**
 * Credential-bearing keys, each as its path relative to whatever object it
 * turns up on. A bare key is a credential wherever it appears; the two-segment
 * entries are qualified because their last segment is not.
 *
 * `code` is deliberately absent on its own. It names a verification code under
 * `membership.tokens`, but everywhere else it is a diagnostic - `err.code`,
 * `DestinyError.code`, an HTTP status code - and redacting those would cost
 * more than it protects.
 * @type {string[][]}
 */
const sensitivePaths = [
    ['access_token'],
    ['accessToken'],
    ['api_key'],
    ['apiKey'],
    ['authorization'],
    ['client_secret'],
    ['cookie'],
    ['id_token'],
    ['password'],
    ['refresh_token'],
    ['refreshToken'],
    ['secret'],
    ['set-cookie'],
    ['tokens', 'blob'],
    ['tokens', 'code'],
    ['x-api-key'],
    ['x-csrf-token'],
];

/**
 * How many objects deep a sensitive key is still caught. Three covers the
 * shapes that actually occur - a key at the root of a log event, one level
 * down under `user` or `bungie`, and two down under `req.headers` or
 * `user.membership.tokens`.
 *
 * Pino compiles `redact` into fixed paths, so depth cannot be unbounded. That
 * is a ceiling on the safety net, not on the protection: the guarantee comes
 * from not logging these objects in the first place, and this catches what
 * slips past.
 * @type {number}
 */
const depth = 3;

/**
 * Render one path at one depth in the bracket notation Pino's redaction
 * accepts, which - unlike dot notation - tolerates a hyphen in a key.
 *
 * @param {string[]} segments
 * @param {number} level - Objects above the path's own first segment.
 * @returns {string}
 */
const toRedactionPath = (segments, level) =>
    Array(level).fill('*').join('.') + segments.map(segment => `["${segment}"]`).join('');

/**
 * Pino's `redact` option. Applied on the root logger, which puts it after the
 * serializers have run and across every child - the only hook that sees both.
 * A `formatters.log` hook sees neither.
 * @type {{ censor: string, paths: string[] }}
 */
const redact = {
    censor,
    paths: sensitivePaths.flatMap(segments =>
        Array.from({ length: depth }, (_, level) => toRedactionPath(segments, level)),
    ),
};

/**
 * Query parameters that carry a credential. Pino's redaction works on object
 * paths, so a secret inside a URL string needs its own pass.
 * @type {Set<string>}
 */
const sensitiveParameters = new Set([
    'access_token',
    'api_key',
    'apikey',
    'blob',
    'client_secret',
    'code',
    'id_token',
    'password',
    'refresh_token',
    'secret',
    'state',
    'token',
]);

/**
 * Censor the sensitive query parameters of a URL, leaving the rest legible.
 *
 * The Bungie OAuth callback arrives as
 * `/users/signIn/Bungie?code=<authorization code>&state=<state>`, and the
 * request line is logged on every request - so without this the code is in the
 * logs before the route has had a chance to exchange it.
 *
 * Parsed by hand rather than through `URL` because what arrives here is the
 * origin-form target (`/path?query`), which has no origin to parse against.
 *
 * @param {string} url
 * @returns {string}
 */
const redactUrl = url => {
    const separator = url.indexOf('?');

    if (separator === -1) {
        return url;
    }

    const parameters = new URLSearchParams(url.slice(separator + 1));
    let censored = false;

    for (const name of [...parameters.keys()]) {
        if (sensitiveParameters.has(name.toLowerCase())) {
            // `set` also collapses a repeated parameter to a single entry,
            // which is the right outcome for one that is being censored.
            parameters.set(name, censor);
            censored = true;
        }
    }

    // An untouched query string is returned verbatim rather than re-encoded.
    return censored ? `${url.slice(0, separator)}?${parameters}` : url;
};

/**
 * Censor the sensitive entries of an already-parsed query, by the same list.
 *
 * Express populates `req.query`, and Pino's request serializer copies it
 * alongside the URL - so censoring only the URL leaves the OAuth code sitting
 * in the object next to it. Key-based redaction cannot cover this: `code` is a
 * credential here and a diagnostic on an error, and the two are only
 * distinguishable from where they sit.
 *
 * @template {Record<string, unknown>} T
 * @param {T} query
 * @returns {T}
 */
const redactQuery = query =>
    /**
     * `Object.fromEntries` widens to `Record<string, unknown>`; every key is
     * preserved and only values are replaced, so the shape is the one given.
     * @type {T}
     */ (
        Object.fromEntries(
            Object.entries(query).map(([name, value]) => [
                name,
                sensitiveParameters.has(name.toLowerCase()) ? censor : value,
            ]),
        )
    );

export default redact;
export { censor, redactQuery, redactUrl, sensitiveParameters, sensitivePaths };
