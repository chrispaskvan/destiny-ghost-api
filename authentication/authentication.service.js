// @ts-check
import { z } from 'zod';
import log from '../helpers/log.js';

/** @typedef {import('../users/user.service.js').User} User */

/**
 * The Bungie token as persisted on a user document. `_ttl` is stamped on by this
 * service when it refreshes a token and is not part of the user schema, so it is
 * modeled here rather than in `userSchema`.
 * @typedef {NonNullable<User['bungie']> & { _ttl?: number }} StoredBungieToken
 */

/**
 * A user document as stored in Cosmos, which is what the cache and user service
 * hand back — the schema shape plus Cosmos system properties such as `id`.
 * @typedef {import('../helpers/documents.js').CosmosDocument<User>} UserDocument
 */

/**
 * A freshly issued Bungie token, which always carries the full set of fields,
 * plus the `_ttl` this service stamps on before persisting it.
 * @typedef {import('../destiny/destiny.service.js').BungieAccessToken & { _ttl?: number }} RefreshedBungieToken
 */

/**
 * How long a successful revalidation defers the next one. `_ttl` is only ever
 * compared against `now` to decide whether to check, so a probe result and a
 * token expiry can share the field. Short enough that a revoked token is noticed
 * quickly; long enough to collapse a burst of requests into one Bungie call.
 */
const REVALIDATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * Credentials identifying the user to authenticate: either a gamer tag paired
 * with its console, or a phone number.
 * @typedef {Object} Credentials
 * @property {string} [displayName]
 * @property {number} [membershipType]
 * @property {string} [phoneNumber]
 */

/**
 * Constructor options for AuthenticationService.
 * @typedef {Object} AuthenticationServiceOptions
 * @property {import('../users/user.cache.js').default} cacheService
 * @property {import('../destiny/destiny.service.js').default} destinyService
 * @property {import('../users/user.service.js').default} userService
 */

/**
 * User Authentication Service Class
 */
class AuthenticationService {
    /**
     * @param {AuthenticationServiceOptions} options
     */
    constructor(options) {
        const schema = z.object({
            cacheService: z.object({}),
            destinyService: z.object({}),
            userService: z.object({}),
        });

        schema.parse(options);

        this.cacheService = options.cacheService;
        this.destinyService = options.destinyService;
        this.userService = options.userService;
    }

    /**
     * Authenticate user by gamer tag and console or phone number.
     * @param {Credentials} [options]
     * @returns {Promise<UserDocument | undefined>}
     */
    async authenticate(options = {}) {
        const { displayName, membershipType, phoneNumber } = options;

        if (!(displayName && membershipType) && !phoneNumber) {
            return undefined;
        }

        /**
         * Split by lookup key rather than nesting ternaries so the compiler can
         * see that the display-name branch has both halves of its key. The cache
         * stores whole user documents, but types its reads as a generic JSON
         * record, hence the cast.
         *
         * @type {UserDocument | undefined}
         */
        let user;

        if (phoneNumber) {
            user = /** @type {UserDocument | undefined} */ (
                await this.cacheService.getUser(phoneNumber)
            );

            if (!user) {
                user = await this.userService.getUserByPhoneNumber(phoneNumber);
            }
        } else if (displayName && membershipType) {
            user = /** @type {UserDocument | undefined} */ (
                await this.cacheService.getUser(displayName, membershipType)
            );

            if (!user) {
                user = await this.userService.getUserByDisplayName(displayName, membershipType);
            }
        }

        return await this.#validateUser(user);
    }

    /**
     * Validate the user's Bungie access token, refreshing it when expired.
     * @param {UserDocument} [user]
     * @returns {Promise<UserDocument | undefined>}
     */
    async #validateUser(user) {
        // Previously a `user = {}` default let the destructure below yield an
        // undefined access token and fall through to the same early return.
        if (!user) {
            return undefined;
        }

        const {
            access_token: accessToken,
            refresh_token: refreshToken,
            _ttl: ttl = 0,
        } = /** @type {Partial<StoredBungieToken>} */ (user.bungie ?? {});
        const now = Temporal.Now.instant().epochMilliseconds;

        if (!accessToken) {
            return undefined;
        }

        if (ttl < now) {
            try {
                // Called only to test the token. Its profile is deliberately
                // discarded: spreading it used to replace the document, so
                // callers saw a different shape depending on token staleness.
                await this.destinyService.getCurrentUser(accessToken);
            } catch {
                return await this.#refreshToken(user, refreshToken, now);
            }

            /**
             * The token outlived its `_ttl`. Without stamping a new one every
             * subsequent request would probe Bungie again — permanently so for
             * records predating `_ttl`, which default to 0 above.
             */
            user.bungie = /** @type {StoredBungieToken} */ ({
                ...user.bungie,
                _ttl: now + REVALIDATION_WINDOW_MS,
            });

            try {
                await this.cacheService.setUser(user);
            } catch (err) {
                // Best-effort: Bungie just approved this token, so a cache
                // failure should cost a repeated probe, not the authentication.
                log.warn({ err, userId: user.id }, 'Failed to cache the revalidated user.');
            }
        }

        return user;
    }

    /**
     * Exchange the stored refresh token for a new one and persist it.
     *
     * @param {UserDocument} user
     * @param {string | undefined} refreshToken
     * @param {number} now - Epoch milliseconds, shared with the caller.
     * @returns {Promise<UserDocument>}
     */
    async #refreshToken(user, refreshToken, now) {
        // Legacy records may carry only an access_token, so there is nothing to
        // refresh with. This previously called Bungie without the parameter and
        // surfaced whatever came back; both reach the client as a 500, so failing
        // here only trades an opaque remote error for a clear local one.
        if (!refreshToken) {
            // The handler returns `message` verbatim to the client, so the
            // field-level detail stays in the log.
            log.warn(
                { userId: user.id },
                'Stored Bungie token has no refresh_token; cannot refresh.',
            );

            throw new Error('Unable to refresh Bungie authentication.');
        }

        const token = await this.destinyService.getAccessTokenFromRefreshToken(refreshToken);
        /** @type {RefreshedBungieToken} */
        const bungie = { ...token, _ttl: now + token.expires_in * 1000 };

        user.bungie = bungie;
        await Promise.all([
            this.cacheService.setUser(user),
            this.userService.updateUserBungie(user.id, bungie),
        ]);

        return user;
    }
}

export default AuthenticationService;
export { REVALIDATION_WINDOW_MS };
