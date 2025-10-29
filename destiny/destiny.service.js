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
import { get, post } from '../helpers/request.js';
import DestinyError from './destiny.error.js';
import configuration from '../helpers/config.js';

const {
    bungie: {
        apiKey, host, clientId, clientSecret,
    },
} = configuration;

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = `${host}/platform`;

/**
 * Destiny Service Class
 */
class DestinyService {
    /**
     * @protected
     * @type {string}
     */
    _api = 'Destiny';

    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.cacheService = options.cacheService;
    }

    /**
     * Get the latest Destiny Manifest definition.
     *
     * @returns {Promise}
     * @protected
     */
    async getManifestFromBungie() {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/${this._api}/Manifest`,
        };
        const {
            data: responseBody,
            headers,
        } = await get(options, true);
        const lastModified = headers['last-modified'];
        const matches = headers['cache-control'].match(/max-age=(\d+)/);
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
     * @param {*} data
     * @returns
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
     * @param code
     * @returns {Promise}
     */
    async getAccessTokenFromCode(code) {
        return await this.constructor.getAccessToken({
            code,
            grant_type: 'authorization_code',
        });
    }

    /**
     * Refresh access token with Bungie.
     *
     * @param refreshToken
     */
    async getAccessTokenFromRefreshToken(refreshToken) {
        return await this.constructor.getAccessToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });
    }

    /**
     * Get Bungie App authorization URL.
     *
     * @param state
     * @returns {Promise}
     */
    getAuthorizationUrl(state) {
        return Promise.resolve(`${host}/en/Oauth/Authorize?client_id=${clientId}&response_type=code&state=${state}`);
    }

    /**
     * Get a list of the member's characters.
     *
     * @param membershipId
     * @param membershipType
     * @returns {Promise}
     */
    async getCharacters(membershipId, membershipType) {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Summary/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { data: { characters } } } = responseBody;

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
     * @param accessToken
     * @returns {Promise}
     */
    async getCurrentUser(accessToken) {
        const options = {
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/User/GetMembershipsForCurrentUser/`,
        };
        const responseBody = await get(options);
        const { Response: user, ErrorCode: errorCode } = responseBody;

        if (user === undefined || errorCode !== 1) {
            const { Message: message, Status: status } = responseBody;

            throw new DestinyError(errorCode, message, status);
        }

        const {
            destinyMemberships,
            bungieNetUser: {
                profilePicturePath,
            } = {},
        } = user;
        const {
            displayName,
            membershipId,
            membershipType,
        } = this.#getPreferredMembership(destinyMemberships);

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
     * @param {boolean} skipCache
     * @returns {Promise}
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
     * @param memberships
     * @private
     */
    #getPreferredMembership(memberships) {
        const [{ crossSaveOverride }] = memberships;

        return memberships.find(({ membershipType }) => membershipType === crossSaveOverride)
            || memberships[0];
    }
}

export default DestinyService;
