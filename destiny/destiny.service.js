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
const qs = require('qs');
const DestinyError = require('./destiny.error');
const {
    bungie: {
        apiKey, authorizationUrl, clientId, clientSecret,
    },
} = require('../helpers/config');
const { get, post } = require('../helpers/request');

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = 'https://www.bungie.net/platform';

/**
 * Destiny Service Class
 */
class DestinyService {
    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.cacheService = options.cacheService;
    }

    /**
     * Get an access token.
     *
     * @static
     * @param {*} data
     * @returns
     * @memberof DestinyService
     */
    static getAccessToken(grant) {
        const data = {
            client_id: clientId,
            client_secret: clientSecret,
            ...grant,
        };
        const options = {
            data: qs.stringify(data),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/app/oauth/token/`,
        };

        return post(options);
    }

    /**
     * Get Bungie access token from code.
     *
     * @param code
     * @returns {Promise}
     */
    getAccessTokenFromCode(code) {
        return this.constructor.getAccessToken({
            code,
            grant_type: 'authorization_code',
        });
    }

    /**
     * Refresh access token with Bungie.
     *
     * @param refreshToken
     */
    getAccessTokenFromRefreshToken(refreshToken) {
        return this.constructor.getAccessToken({
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
    getAuthorizationUrl(state) { // eslint-disable-line class-methods-use-this
        return Promise.resolve(`${authorizationUrl}?client_id=${clientId}&response_type=code&state=${state}`);
    }

    /**
     * Get a list of the member's characters.
     *
     * @param membershipId
     * @param membershipType
     * @returns {Promise}
     */
    // eslint-disable-next-line class-methods-use-this
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
        } = this.getPreferredMembership(destinyMemberships);

        return {
            displayName,
            membershipId,
            membershipType,
            profilePicturePath,
        };
    }

    /**
     * Get the lastest Destiny Manifest definition.
     *
     * @param skipCache
     * @returns {Promise}
     */
    async getManifest(skipCache) {
        let manifest = await this.cacheService.getManifest();

        if (!skipCache && manifest) {
            return manifest;
        }

        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny/Manifest`,
        };
        const responseBody = await get(options);

        ({ Response: manifest } = responseBody);

        this.cacheService.setManifest(manifest);

        return manifest;
    }

    /**
     * @private
     * @param memberships
     */
    getPreferredMembership(memberships) { // eslint-disable-line class-methods-use-this
        const [{ crossSaveOverride }] = memberships;

        return memberships.find(({ membershipType }) => membershipType === crossSaveOverride)
            || memberships[0];
    }
}

module.exports = DestinyService;
