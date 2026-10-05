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
import { get, post } from '../helpers/bungie.request.js';
import supportedMembershipTypes from '../helpers/bungie.membershipTypes.js';
import DestinyError from './destiny.error.js';
import configuration from '../helpers/config.js';
import log from '../helpers/log.js';

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
 * @property {number} membershipType - A Bungie platform value; see `helpers/bungie.membershipTypes.js`.
 * @property {number} [crossSaveOverride] - The membershipType that owns cross-saved data, or 0 when cross save is off
 */

/**
 * The current user, flattened to the fields this application stores.
 * @typedef {Object} CurrentUser
 * @property {string} displayName
 * @property {string} membershipId
 * @property {SupportedMembershipType} membershipType
 * @property {string} [profilePicturePath]
 */

/**
 * A Destiny 1 character summary as returned by the Account/Summary endpoint.
 * @typedef {Object} DestinyCharacter
 * @property {string} characterId
 * @property {number} [characterLevel]
 * @property {{ membershipId: string, membershipType: number }} [characterBase]
 */

/** @typedef {import('../helpers/bungie.membershipTypes.js').SupportedMembershipType} SupportedMembershipType */
/** @typedef {import('./destiny.cache.js').DestinyManifest} DestinyManifest */
/** @typedef {import('./destiny.cache.js').ManifestResult} ManifestResult */

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = `${host}/platform`;

/**
 * @constant
 * @type {string}
 * @description Base URL for the Destiny 1 API. Bungie redirects
 * `/platform/Destiny/` here by way of plain HTTP, which would send the API key
 * unencrypted, so it is requested directly. Every Bungie API path ends with a
 * slash; without one, Bungie answers with a redirect to it.
 */
const destinyPlatform = `${host}/d1/platform`;

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
     * Base URL for this game's API, which the manifest is requested from.
     * @protected
     * @type {string}
     */
    _platform = destinyPlatform;

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
            url: `${this._platform}/${this._api}/Manifest/`,
        };
        const { data: responseBody, headers } =
            /** @type {{ data: BungieResponse<DestinyManifest>, headers: Record<string, string | undefined> }} */ (
                await get(options, true)
            );
        const lastModified = headers['last-modified'];
        // Bungie omits cache-control on some responses; a missing or unparseable
        // header yields a zero max-age, which skips the cache write below.
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

            // Redis rejects a zero TTL, so a response without a usable max-age is
            // returned uncached rather than failing SETEX on every manifest fetch.
            if (maxAge > 0) {
                await this.cacheService.setManifest({ lastModified, manifest, maxAge });
            }

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
            data: new URLSearchParams(data).toString(),
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
            url: `${destinyPlatform}/Destiny/${membershipType}/Account/${membershipId}/Summary/`,
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
     * Resolves undefined when the account has nothing this application can sign
     * in - no Destiny memberships at all, or none on a supported platform. That
     * is a client outcome, not a failure: `users/user.routes.js` turns it into
     * the same 404 an unknown user gets, having created nothing.
     *
     * @param {string} accessToken
     * @returns {Promise<CurrentUser | undefined>}
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
            const { Message: message, ErrorStatus: status } = responseBody;

            throw new DestinyError(errorCode, message ?? '', status ?? '');
        }

        const { destinyMemberships, bungieNetUser: { profilePicturePath } = {} } = user;
        const membership = this.#getPreferredMembership(destinyMemberships);

        if (!membership) {
            return undefined;
        }

        const { displayName, membershipId, membershipType } = membership;

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
     * The membership the player actually plays on: either the one cross save
     * points at, or an account that never enabled it. Every membership on a
     * cross-saved account carries the owner's `membershipType`, so the owner is
     * the one that names itself.
     *
     * @param {DestinyMembership[]} memberships
     * @returns {(DestinyMembership & { membershipType: SupportedMembershipType }) | undefined}
     * undefined when nothing here is playable
     */
    #getPreferredMembership(memberships) {
        const membership = memberships.find(
            ({ crossSaveOverride, membershipType }) =>
                !crossSaveOverride || crossSaveOverride === membershipType,
        );

        if (!membership) {
            log.info({ memberships: memberships.length }, 'No playable Destiny membership');

            return undefined;
        }

        const membershipType = /** @type {SupportedMembershipType} */ (membership.membershipType);

        if (!supportedMembershipTypes.includes(membershipType)) {
            log.info({ membershipType }, 'Destiny membership is on an unsupported platform');

            return undefined;
        }

        return /** @type {DestinyMembership & { membershipType: SupportedMembershipType }} */ (
            membership
        );
    }
}

export default DestinyService;
