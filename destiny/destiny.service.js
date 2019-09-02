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
const _ = require('underscore'),
    DestinyError = require('./destiny.error'),
    {
        apiKey, authorizationUrl, clientId, clientSecret,
    } = require('../settings/bungie.json'),
    { gunSmithHash, lordSaladinHash, xurHash } = require('./destiny.constants'),
    { get, post } = require('../helpers/request'),
    qs = require('qs');

/**
 * Available Membership Types
 * @type {{TigerXbox: number, TigerPsn: number}}
 * @description Membership types as defined by the Bungie Destiny API
 * outlined at {@link http://bungienetplatform.wikia.com/wiki/BungieMembershipType}.
 */
const membershipTypes = {
    TigerXbox: 1,
    TigerPsn: 2,
};

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
     * Get Bungie access token from code.
     *
     * @param code
     * @returns {Promise}
     */
    async getAccessTokenFromCode(code) {
	    const data = {
		    client_id: clientId,
		    client_secret: clientSecret,
		    grant_type: 'authorization_code',
		    code,
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
     * Refresh access token with Bungie.
     *
     * @param refreshToken
     */
    getAccessTokenFromRefreshToken(refreshToken) {
        const data = {
	        client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
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
     * Get Bungie App authorization URL.
     *
     * @param state
     * @returns {Promise}
     */
    getAuthorizationUrl(state) {
        return Promise.resolve(`${authorizationUrl}?client_id=${clientId}&response_type=code&state=${state}`);
    }

    /**
     * Get Activity of a character.
     *
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getActivity(accessToken, characterId, membershipId, membershipType) {
        const options = {
	        headers: {
		        authorization: `Bearer ${accessToken}`,
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Activities/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const character = JSON.parse(body).Response;

            return character;
        }

        throw new DestinyError(responseBody.ErrorCode || -1,
            responseBody.Message || '', responseBody.ErrorStatus || '');
    }

    /**
     * Get details of a character.
     *
     * @param membershipId
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getCharacter(accessToken, characterId, membershipId, membershipType) {
        const options = {
	        headers: {
		        authorization: `Bearer ${accessToken}`,
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Complete/`,
        };
	    const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { data: { character } } } = responseBody;

            return character;
        }

        throw new DestinyError(responseBody.ErrorCode || -1,
            responseBody.Message || '', responseBody.ErrorStatus || '');
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

        throw new DestinyError(responseBody.ErrorCode || -1,
            responseBody.Message || '', responseBody.ErrorStatus || '');
    }

    /**
     * Get the Bungie member number from the user's display name.
     *
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    async getMembershipIdFromDisplayName(displayName, membershipType) {
        const encodedDisplayName = encodeURIComponent(displayName);
        const options = {
	        headers: {
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/${membershipType}/Stats/GetMembershipIdByDisplayName/${encodedDisplayName}/`,
        };
	    const { Response: membershipId } = await get(options);

	    return membershipId;
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
	        url: `${servicePlatform}/User/GetBungieNetUser/`,
        };
	    const responseBody = await get(options);
	    const { Response: user, ErrorCode: errorCode } = responseBody;

        if (user === undefined || errorCode !== 1) {
            const { Message: message, Status: status } = responseBody;

            throw new DestinyError(errorCode, message, status);
        } else {
            const {
                email, gamerTag, psnId, user: { profilePicturePath } = {},
            } = user;
            const displayName = psnId || gamerTag;

            if (!displayName) {
                throw new Error('Gamer tag not found.');
            }

            const membershipType = psnId ? membershipTypes.TigerPsn : membershipTypes.TigerXbox;
            const membershipId = await this.getMembershipIdFromDisplayName(displayName, membershipType);

            if (!membershipId) {
	            throw new Error(`membershipId is undefined for the displayName ${displayName} and membershipType ${membershipType}.`);
            }

            return {
                displayName,
                email,
                membershipId,
                membershipType,
                profilePicturePath,
            };
        }
    }

    /**
     * Get available field test weapons from the Gun Smith.
     *
     * @param characterId
     * @param membershipType
     * @param accessToken
     * @returns {Promise}
     */
    async getFieldTestWeapons(characterId, membershipType, accessToken) {
        const vendor = await this.cacheService.getVendor(gunSmithHash);
        const now = (new Date()).toISOString();
        const { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        }

        const options = {
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendor/${gunSmithHash}/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { data } } = responseBody;

            if (data) {
                const { vendorHash, nextRefreshDate, saleItemCategories } = data;
                const fieldTestWeapons = saleItemCategories
                    .find(saleItemCategory => saleItemCategory.categoryTitle === 'Field Test Weapons');
                const itemHashes = fieldTestWeapons.saleItems.map(saleItem => {
                    const { item: { itemHash } } = saleItem;

                    return itemHash;
                });
                const vendor = {
                    vendorHash,
                    nextRefreshDate,
                    itemHashes,
                };

                this.cacheService.setVendor(vendor);

                return vendor;
            }

            return [];
        }

        throw new DestinyError(responseBody.ErrorCode,
            responseBody.Message, responseBody.Status);
    }

    /**
     * Get available Foundry Orders from the Gun Smith.
     *
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getFoundryOrders(characterId, accessToken, membershipType) {
        const vendor = await this.cacheService.getVendor(gunSmithHash);
        const now = (new Date()).toISOString();
        const { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        }

        const options = {
	        headers: {
		        authorization: `Bearer ${accessToken}`,
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendor/${gunSmithHash}/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { data } } = responseBody;

            if (data) {
                const { vendorHash, nextRefreshDate, saleItemCategories } = data;
                const foundryOrdersCategory = saleItemCategories
                    .find(saleItemCategory => saleItemCategory.categoryTitle === 'Foundry Orders');
                const foundryOrders = (typeof foundryOrdersCategory === 'object')
                    ? foundryOrdersCategory.saleItems : [];
                const itemHashes = foundryOrders.map(saleItem => {
                    const { item: { itemHash } } = saleItem;

                    return itemHash;
                });

                const vendor = {
                    vendorHash,
                    nextRefreshDate,
                    itemHashes,
                };

                this.cacheService.setVendor(vendor);

                return vendor;
            }

	        return [];
        }

	    throw new DestinyError(responseBody.ErrorCode,
		    responseBody.Message, responseBody.Status);
    }

    /**
     * Get character's inventory.
     *
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getInventory(characterId, membershipId, membershipType, accessToken) {
	    const options = {
		    headers: {
			    authorization: `Bearer ${accessToken}`,
			    'x-api-key': apiKey,
		    },
		    url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Inventory/`,
	    };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const character = responseBody.Response.data;

            return character;
        }

	    throw new DestinyError(responseBody.ErrorCode || -1,
		    responseBody.Message || '', responseBody.ErrorStatus || '');
    }

    /**
     * Get available Iron Banner Event rewards from Lord Saladin.
     * @param characterId
     * @param accessToken
     * @returns {Array}
     */
    async getIronBannerEventRewards(characterId, membershipType, accessToken) {
	    const options = {
		    headers: {
			    authorization: `Bearer ${accessToken}`,
			    'x-api-key': apiKey,
		    },
		    url: `${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendor/${lordSaladinHash}/`,
	    };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1627) {
            return [];
        }
        if (responseBody.ErrorCode === 1) {
            const data = responseBody.Response.data;

            if (data) {
                const saleItemCategories = data.saleItemCategories;
                const eventRewards = _.find(saleItemCategories, saleItemCategory => saleItemCategory.categoryTitle === 'Event Rewards');

                this.cacheService.set('getIronBannerEventRewards', eventRewards.saleItems);

                return eventRewards.saleItems;
            }

	        return [];
        }

	    throw new DestinyError(responseBody.ErrorCode
		    || -1, responseBody.Message || '',
		    responseBody.ErrorStatus || '');
    }

    /**
     * Get item from hash.
     *
     * @param itemHash
     * @param accessToken
     * @returns {Promise}
     */
    async getItem(itemHash, accessToken) {
        const options = {
	        headers: {
		        authorization: `Bearer ${accessToken}`,
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/Manifest/2/${itemHash}/`,
        };
	    const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            return responseBody;
        }

	    throw new DestinyError(responseBody.ErrorCode || -1,
		    responseBody.Message || '', responseBody.ErrorStatus || '');
    }

    /**
     * Get the lastest Destiny Manifest definition.
     *
     * @param noCache
     * @returns {Promise}
     */
    async getManifest(noCache) {
        let manifest = await this.cacheService.getManifest();

        if (!noCache && manifest) {
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
     * Get character progression.
     *
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getProgression(characterId, membershipId, membershipType, accessToken) {
        const options = {
	        headers: {
		        authorization: `Bearer ${accessToken}`,
		        'x-api-key': apiKey,
	        },
	        url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Progression/`,
        };
	    const responseBody = await get(options);
        const { Response: character } = responseBody;

        return character;
    }

    /**
     * Get vendor summaries for a character.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getVendorSummaries(characterId, membershipType, accessToken) {
	    const options = {
		    headers: {
			    authorization: `Bearer ${accessToken}`,
			    'x-api-key': apiKey,
		    },
		    url: `${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendors/Summaries/`,
	    };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { data } } = responseBody;

            return data ? resolve(data.vendors) : [];
        }

	    throw new DestinyError(responseBody.ErrorCode
		    || -1, responseBody.Message || '',
		    responseBody.ErrorStatus || '');
    }

    /**
     * Get character's weapons.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getWeapons(characterId, membershipId, membershipType, accessToken) {
	    const options = {
		    headers: {
			    authorization: `Bearer ${accessToken}`,
			    'x-api-key': apiKey,
		    },
		    url: '${servicePlatform}/Destiny/stats/uniqueweapons/${membershipType}/${membershipId}/${characterId}/',
	    };
        const responseBody = await get(options);
        const { Response: { data: { weapons } } } = responseBody;

        return weapons.sort((a, b) => {
            if (a.values.uniqueWeaponKillsPrecisionKills.basic.value
                < b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                return -1;
            }
            if (a.values.uniqueWeaponKillsPrecisionKills.basic.value
                > b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                return 1;
            }

            return 0;
        });
    }

    /**
     * Get the exotic gear and weapons available for sale from Xur.
     * @returns {Promise}
     */
    async getXur() {
        const now = (new Date()).toISOString();
        let vendor = await this.cacheService.getVendor(xurHash);
        let { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        }

        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/Advisors/Xur/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1627) {
            return [];
        }
        if (responseBody.ErrorCode === 1) {
            const { Response: { data } } = responseBody;

            if (data) {
                const { vendorHash, saleItemCategories } = data;
                ({ nextRefreshDate } = data);
                const exotics = saleItemCategories.find(saleItemCategory => saleItemCategory.categoryTitle === 'Exotic Gear');
                const itemHashes = exotics.saleItems.map(saleItem => {
                    const { item: { itemHash } } = saleItem;

                    return itemHash;
                });
                vendor = {
                    vendorHash,
                    nextRefreshDate,
                    itemHashes,
                };

                this.cacheService.setVendor(vendor);

                return vendor;
            }

            return [];
        }

        throw new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '',
            responseBody.ErrorStatus || '');
    }
}

module.exports = DestinyService;
