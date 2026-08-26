// @ts-check
import { z } from 'zod';

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

/** @typedef {import('../destiny/destiny.service.js').CurrentUser} CurrentUser */

/**
 * A freshly issued Bungie token, which always carries the full set of fields,
 * plus the `_ttl` this service stamps on before persisting it.
 * @typedef {import('../destiny/destiny.service.js').BungieAccessToken & { _ttl?: number }} RefreshedBungieToken
 */

/**
 * What authentication resolves to. When the stored token is still valid this is
 * the user document. When the token had to be revalidated against Bungie, that
 * profile is spread instead, so document-only fields such as `id` are absent on
 * that path. See issue #671.
 * @typedef {UserDocument
 *   | (CurrentUser & { bungie: Partial<StoredBungieToken>, dateRegistered?: string })
 * } AuthenticatedUser
 */

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
     * @returns {Promise<AuthenticatedUser | undefined>}
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
     * @returns {Promise<AuthenticatedUser | undefined>}
     */
    async #validateUser(user) {
        // Previously a `user = {}` default let the destructure below yield an
        // undefined access token and fall through to the same early return.
        if (!user) {
            return undefined;
        }

        const { dateRegistered } = user;
        const {
            access_token: accessToken,
            membership_id: membershipId,
            refresh_token: refreshToken,
            _ttl: ttl = 0,
        } = /** @type {Partial<StoredBungieToken>} */ (user.bungie ?? {});
        const now = Temporal.Now.instant().epochMilliseconds;

        if (!accessToken) {
            return undefined;
        }

        /**
         * Held separately rather than reassigning `user` so the catch below still
         * sees the stored document. Note that when revalidation succeeds this
         * profile is what gets spread into the result, so document-only fields
         * do not survive that path and `displayName` comes from Bungie rather
         * than the stored document. See issue #671.
         *
         * @type {CurrentUser | undefined}
         */
        let revalidated;

        if (ttl < now) {
            try {
                revalidated = await this.destinyService.getCurrentUser(accessToken);
            } catch {
                // `refresh_token` is optional on stored tokens; a record without
                // one has always failed here rather than being guarded.
                const bungie = /** @type {RefreshedBungieToken} */ (
                    await this.destinyService.getAccessTokenFromRefreshToken(
                        /** @type {string} */ (refreshToken),
                    )
                );

                bungie._ttl = now + bungie.expires_in * 1000;
                user.bungie = bungie;
                await Promise.all([
                    this.cacheService.setUser(user),
                    this.userService.updateUserBungie(user.id, bungie),
                ]);

                return user;
            }
        }

        return {
            bungie: {
                access_token: accessToken,
                membership_id: membershipId,
                refresh_token: refreshToken,
            },
            dateRegistered,
            ...(revalidated ?? user),
        };
    }
}

export default AuthenticationService;
