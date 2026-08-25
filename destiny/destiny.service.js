// @ts-check
/**
 * A module for interacting with the Bungie Destiny web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny web API.
 * @author Chris Paskvan
 * @description Utility functions for requests against the Bungie web API for
 * managing users and destiny characters, etc. For more information check out
 * the wiki at {@link http://bungienetplatform.wikia.com/wiki/Endpoints} or
 * the Bungie web API platform help page {@link https://www.bungie.net/platform/destiny/help/}.
 */
import { stringify } from 'qs';
import { get, post } from '../helpers/bungie.request.js';
import DestinyError from './destiny.error.js';
import configuration from '../helpers/config.js';

const {
    bungie: { apiKey, host, clientId, clientSecret },
} = configuration;

/**
 * The envelope Bungie wraps around every platform response. `ErrorCode` is 1 on
 * success; any other value is an error the services translate into a DestinyError.
 * @template [T=*]
 * @typedef {Object} BungieResponse
 * @property {number} ErrorCode
 * @property {string} [Message]
 * @property {string} [ErrorStatus]
 * @property {string} [Status]
 * @property {T} Response
 */

/**
 * An OAuth token grant exchanged with Bungie, minus the client credentials this
 * service supplies itself.
 * @typedef {{ code: string, grant_type: 'authorization_code' }
 *   | { refresh_token: string, grant_type: 'refresh_token' }} OAuthGrant
 */

/**
 * A Bungie OAuth token response.
 * @typedef {Object} BungieAccessToken
 * @property {string} access_token
 * @property {number} expires_in
 * @property {string} membership_id
 * @property {string} refresh_token
 * @property {string} [token_type]
 */

/**
 * One of a Bungie.net account's linked Destiny platform memberships.
 * @typedef {Object} DestinyMembership
 * @property {string} displayName
 * @property {string} membershipId
 * @property {number} membershipType - Platform: 1 Xbox, 2 PSN, 3 Steam, etc.
 * @property {number} [crossSaveOverride] - The membershipType that owns cross-saved data
 */

/**
 * The current user, flattened to the fields this application stores.
 * @typedef {Object} CurrentUser
 * @property {string} displayName
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} [profilePicturePath]
 */

/**
 * A Destiny 1 character summary as returned by the Account/Summary endpoint.
 * @typedef {Object} DestinyCharacter
 * @property {string} characterId
 * @property {number} [characterLevel]
 * @property {{ membershipId: string, membershipType: number }} [characterBase]
 */

/** @typedef {import('./destiny.cache.js').DestinyManifest} DestinyManifest */
/** @typedef {import('./destiny.cache.js').ManifestResult} ManifestResult */

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = `${host}/platform`;

/**
 * Destiny Service Class
 *
 * Generic over the cache implementation so `Destiny2Service` can reach the
 * Destiny 2-only cache methods through the inherited `cacheService` field.
 * @template {import('./destiny.cache.js').default} [TCache=import('./destiny.cache.js').default]
 */
class DestinyService {
    /**
     * @protected
     * @type {string}
     */
    _api = 'Destiny';

    /**
     * @param {{ cacheService: TCache }} options
     */
    constructor(options) {
        this.cacheService = options.cacheService;
    }

    /**
     * Get the latest Destiny Manifest definition.
     *
     * @returns {Promise<ManifestResult>}
     * @protected
     */
    async getManifestFromBungie() {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/${this._api}/Manifest`,
        };
        const { data: responseBody, headers } =
            /** @type {{ data: BungieResponse<DestinyManifest>, headers: Record<string, string | undefined> }} */ (
                await get(options, true)
            );
        const lastModified = headers['last-modified'];
        // Bungie omits cache-control on some responses; missing or unparseable
        // falls back to a zero max-age, same as a header without a max-age directive.
        const matches = headers['cache-control']?.match(/max-age=(\d+)/);
        const maxAge = matches ? parseInt(matches[1], 10) : 0;

        if (responseBody.ErrorCode === 1) {
            const { Response: manifest } = responseBody;
            const result = {
                data: {
                    manifest,
                },
                meta: {
                    lastModified,
                    maxAge,
                },
            };

            await this.cacheService.setManifest({ lastModified, manifest, maxAge });

            return result;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }

    /**
     * Get an access token.
     *
     * @static
     * @param {OAuthGrant} grant
     * @returns {Promise<BungieAccessToken>}
     * @memberof DestinyService
     */
    static async getAccessToken(grant) {
        const data = {
            client_id: clientId,
            client_secret: clientSecret,
            ...grant,
        };
        const options = {
            data: stringify(data),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/app/oauth/token/`,
        };

        return await post(options);
    }

    /**
     * Get Bungie access token from code.
     *
     * @param {string} code
     * @returns {Promise<BungieAccessToken>}
     */
    async getAccessTokenFromCode(code) {
        // Cast because `this.constructor` is typed as the base `Function`; going
        // through it (rather than naming the class) keeps the static overridable.
        return await /** @type {typeof DestinyService} */ (this.constructor).getAccessToken({
            code,
            grant_type: 'authorization_code',
        });
    }

    /**
     * Refresh access token with Bungie.
     *
     * @param {string} refreshToken
     * @returns {Promise<BungieAccessToken>}
     */
    async getAccessTokenFromRefreshToken(refreshToken) {
        return await /** @type {typeof DestinyService} */ (this.constructor).getAccessToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });
    }

    /**
     * Get Bungie App authorization URL.
     *
     * @param {string} state
     * @returns {Promise<string>}
     */
    getAuthorizationUrl(state) {
        return Promise.resolve(
            `${host}/en/Oauth/Authorize?client_id=${clientId}&response_type=code&state=${state}`,
        );
    }

    /**
     * Get a list of the member's characters.
     *
     * @param {string} membershipId
     * @param {number} membershipType
     * @returns {Promise<DestinyCharacter[]>}
     */
    async getCharacters(membershipId, membershipType) {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Summary/`,
        };
        const responseBody =
            /** @type {BungieResponse<{ data: { characters: DestinyCharacter[] } }>} */ (
                await get(options)
            );

        if (responseBody.ErrorCode === 1) {
            const {
                Response: {
                    data: { characters },
                },
            } = responseBody;

            return characters;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }

    /**
     * Get the current user based on the Bungie access token.
     *
     * @param {string} accessToken
     * @returns {Promise<CurrentUser>}
     */
    async getCurrentUser(accessToken) {
        const options = {
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/User/GetMembershipsForCurrentUser/`,
        };
        const responseBody =
            /** @type {BungieResponse<{ destinyMemberships: DestinyMembership[], bungieNetUser?: { profilePicturePath?: string } } | undefined>} */ (
                await get(options)
            );
        const { Response: user, ErrorCode: errorCode } = responseBody;

        if (user === undefined || errorCode !== 1) {
            const { Message: message, Status: status } = responseBody;

            throw new DestinyError(errorCode, message, status);
        }

        const { destinyMemberships, bungieNetUser: { profilePicturePath } = {} } = user;
        const { displayName, membershipId, membershipType } =
            this.#getPreferredMembership(destinyMemberships);

        return {
            displayName,
            membershipId,
            membershipType,
            profilePicturePath,
        };
    }

    /**
     * Get the cached Destiny Manifest definition if available,
     *   otherwise get the latest from Bungie.
     * @param {boolean} [skipCache]
     * @returns {Promise<ManifestResult>}
     */
    async getManifest(skipCache) {
        const cache = await this.cacheService.getManifest();

        if (!skipCache && cache) {
            cache.meta.wasCached = true;

            return cache;
        }

        return await this.getManifestFromBungie();
    }

    /**
     * Pick the membership that owns cross-saved data, falling back to the first.
     *
     * @param {DestinyMembership[]} memberships
     * @returns {DestinyMembership}
     */
    #getPreferredMembership(memberships) {
        const [{ crossSaveOverride }] = memberships;

        return (
            memberships.find(({ membershipType }) => membershipType === crossSaveOverride) ||
            memberships[0]
        );
    }
}

export default DestinyService;
