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
 *
 * No reserved characters, so it reads the same wherever it lands. Brackets
 * were percent-encoded on their way through `URLSearchParams`, which left a
 * censored query parameter spelled differently from every other censored
 * value.
 * @type {string}
 */
const censor = 'REDACTED';

/**
 * Keys whose value is a credential, censored at the root of a log event.
 *
 * `tokens` and `bungie` are censored whole rather than by member. `tokens` is
 * the verification pair under `membership` and the email blob paired with the
 * SMS code on a join request; `bungie` is the stored OAuth grant. Both are
 * secret in every field, censoring the object covers a field added later, and
 * naming the container is what lets a user document be caught under whatever
 * key it was logged under rather than only under `user`.
 *
 * `code` is deliberately absent. Under `tokens` it is a verification code, but
 * everywhere else it is a diagnostic - `err.code`, `DestinyError.code` - and
 * redacting those would cost more than it protects. It is handled by position
 * instead: inside `tokens` above, and as a query parameter below.
 *
 * Header names are listed in more than one casing because these paths are
 * matched case-sensitively while header names are not. Node lower-cases what
 * it parses off the wire, so the lower-case spellings cover anything incoming;
 * the others cover headers built by hand, which this codebase writes as
 * `Authorization` (`helpers/bitly.js`, `twilio/mms.service.js`) and, for now,
 * as lower-case `x-api-key` everywhere. `X-API-Key` is listed anyway because
 * that is the spelling Bungie's own documentation uses, and a root-tier key
 * costs nothing.
 * @type {string[]}
 */
const sensitiveKeys = [
    'access_token',
    'accessToken',
    'api_key',
    'apiKey',
    'Authorization',
    'authorization',
    'bungie',
    'client_secret',
    'Cookie',
    'cookie',
    'id_token',
    'password',
    'refresh_token',
    'refreshToken',
    'secret',
    'set-cookie',
    'tokens',
    'X-API-Key',
    'x-api-key',
    'x-csrf-token',
];

/**
 * The subset of those also censored one level down, for the shape an
 * accidental `log.info(user)` produces - `bungie.access_token` under a
 * spread-out document.
 *
 * It is a subset because a wildcard is what redaction costs: Pino examines
 * every key at that level for every wildcarded path, about 390ns per path per
 * line, while a root key or a spelled-out path compiles to a direct read.
 * Header names are left out because they do not occur one level down - they
 * live at `req.headers`, which `knownPaths` reaches for free.
 * @type {string[]}
 */
const nestableKeys = [
    'access_token',
    'accessToken',
    'bungie',
    'id_token',
    'password',
    'refresh_token',
    'refreshToken',
    'secret',
    'tokens',
];

/**
 * The shapes this codebase actually produces that sit deeper than that, named
 * rather than swept for.
 *
 * `membership.tokens` keeps a leading wildcard because the key a user document
 * gets logged under is not predictable - `user.membership.tokens` would have
 * left the same document in the clear under any other name. Its `bungie`
 * counterpart needs no entry here: `bungie` is a censored key in both tiers
 * above, so the grant is caught wherever the document sits.
 * @type {string[]}
 */
const knownPaths = [
    '*.membership.tokens',
    'req.headers.Authorization',
    'req.headers.authorization',
    'req.headers.Cookie',
    'req.headers.cookie',
    'req.headers["X-API-Key"]',
    'req.headers["x-api-key"]',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
];

/**
 * Pino's `redact` option: the root tier, the one-level tier, and the shapes
 * named outright.
 *
 * Applied on the root logger, which puts it after the serializers have run and
 * across every child - the only hook that sees both. A `formatters.log` hook
 * sees neither.
 *
 * This is a safety net with a stated ceiling, not the guarantee. The guarantee
 * is that these objects are not logged in the first place; this catches what
 * slips past, and what it catches is bounded in two ways worth knowing:
 *
 * - Nothing below the second level, unless `knownPaths` names it.
 * - Nothing inside an array. An index consumes a level, so a credential in
 *   `users[0].bungie` is out of reach however the tiers are set - which
 *   matters here, because the broadcast path works on arrays of users.
 *
 * Both are arguments for keeping call sites narrow rather than for widening
 * this, which is paid on every line the process writes.
 * @type {{ censor: string, paths: string[] }}
 */
const redact = {
    censor,
    paths: [
        ...sensitiveKeys.map(key => `["${key}"]`),
        ...nestableKeys.map(key => `*["${key}"]`),
        ...knownPaths,
    ],
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
export {
    censor,
    knownPaths,
    nestableKeys,
    redactQuery,
    redactUrl,
    sensitiveKeys,
    sensitiveParameters,
};
