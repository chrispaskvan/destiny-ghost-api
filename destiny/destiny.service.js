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
	{ apiKey, authorizationUrl, clientId, clientSecret } = require('../settings/bungie.json'),
    { gunSmithHash, lordSaladinHash, xurHash } = require('./destiny.constants'),
	axios = require('axios');

/**
 * Available Membership Types
 * @type {{TigerXbox: number, TigerPsn: number}}
 * @description Membership types as defined by the Bungie Destiny API
 * outlined at {@link http://bungienetplatform.wikia.com/wiki/BungieMembershipType}.
 */
const membershipTypes = {
    TigerXbox: 1,
    TigerPsn: 2
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
	    const { data: responseBody } = await axios({
			body: 'client_id=${clientId}&client_secret=${clientSecret}&grant_type=authorization_code&code=${code}',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'x-api-key': apiKey
			},
            method: 'post',
			url: `${servicePlatform}/app/oauth/token/`
		});

	    return responseBody;
    }

    /**
     * Refresh access token with Bungie.
     *
     * @param refreshToken
     */
    async getAccessTokenFromRefreshToken(refreshToken) {
        const opts = {
	        body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token&refresh_token=${refreshToken}`,
	        headers: {
		        'Content-Type': 'application/x-www-form-urlencoded',
		        'x-api-key': apiKey
	        },
	        method: 'post',
	        url: `${servicePlatform}/app/oauth/token/`
        };
        try {
	        const { data: responseBody } = await axios(opts);
        }
        catch (err) {
            throw err;
        }

	    return responseBody;
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
    async getActivity(characterId, membershipId, membershipType, accessToken) {
        const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Activities/`
        });

        if (responseBody.ErrorCode === 1) {
            const character = JSON.parse(body).Response;

            return character;
        } else {
            throw new DestinyError(responseBody.ErrorCode || -1,
                responseBody.Message || '', responseBody.ErrorStatus || '');
        }
    }

    /**
     * Get details of a character.
     *
     * @param membershipId
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getCharacter(membershipId, characterId, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/2/Account/${membershipId}/Character/${characterId}/Complete/`
        });

        if (responseBody.ErrorCode === 1) {
            const character = responseBody.Response.data;

            return character;
        } else {
            throw new DestinyError(responseBody.ErrorCode || -1,
                responseBody.Message || '', responseBody.ErrorStatus || '');
        }
    }

    /**
     * Get a list of the member's characters.
     * @param membershipId
     * @param membershipType
     * @returns {Promise}
     */
    async getCharacters(membershipId, membershipType) {
	    const { data: responseBody } = await axios({
            headers: {
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Summary/`
        });

        if (responseBody.ErrorCode === 1) {
            const { Response: { data: { characters }}} = responseBody;

            return characters;
        } else {
            throw new DestinyError(responseBody.ErrorCode || -1,
                responseBody.Message || '', responseBody.ErrorStatus || '');
        }
    }

    /**
     * Get the Bungie member number from the user's display name.
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    async getMembershipIdFromDisplayName(displayName, membershipType) {
        const encodedDisplayName = encodeURIComponent(displayName);
	    const { data: responseBody } = await axios({
            headers: {
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/${membershipType}/Stats/GetMembershipIdByDisplayName/${encodedDisplayName}/`
        });
	    const { membershipId } = responseBody;

	    return membershipId;
    }

    /**
     * Get the current user based on the Bungie access token.
     * @param accessToken
     * @returns {Promise}
     */
    async getCurrentUser(accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/User/GetBungieNetUser/`
        });

        if (responseBody.Reponse !== undefined || responseBody.ErrorCode !== 1) {
            throw new DestinyError(responseBody.ErrorCode, responseBody.Message, responseBody.Status);
        } else {
            const user = responseBody.Response;
            const gamerTag = user.psnId || user.gamerTag;

            if (!gamerTag) {
                throw new Error('Gamer tag not found.');
            }

            const membershipType = user.psnId ? membershipTypes.TigerPsn : membershipTypes.TigerXbox;
            const membershipId = await this.getMembershipIdFromDisplayName(gamerTag, membershipType);

            if (user) {
                return {
                    displayName: user.psnId,
                    email: user.email,
                    membershipId: membershipId,
                    membershipType: membershipType,
                    profilePicturePath: user.user.profilePicturePath
                };
            }

            throw new Error('membershipId undefined for the following gamerTag and membershipType: ' +
                gamerTag + ',' + membershipType);
        }
    }

    /**
     * Get available field test weapons from the Gun Smith.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getFieldTestWeapons(characterId, membershipType, accessToken) {
        const vendor = await this.cacheService.getVendor(gunSmithHash)
        const now = (new Date()).toISOString();
        const { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        } else {
	        const { data: responseBody } = await axios({
                headers: {
                    authorization: 'Bearer ' + accessToken,
                    'x-api-key': apiKey
                },
                method: 'get',
                url: '${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendor/${gunSmithHash}/'
            });

            if (responseBody.ErrorCode === 1) {
                const { Response: { data }} = responseBody;

                if (data) {
                    const { vendorHash, nextRefreshDate, saleItemCategories } = data;
                    const fieldTestWeapons = saleItemCategories
                        .find(saleItemCategory => saleItemCategory.categoryTitle === 'Field Test Weapons');
                    const itemHashes = fieldTestWeapons.saleItems.map((saleItem) => {
                        const { item: { itemHash }} = saleItem;

                        return itemHash;
                    });

                    const vendor = {
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    };

                    this.cacheService.setVendor(vendor);

                    return vendor;
                } else {
                    return [];
                }
            } else {
                throw new DestinyError(responseBody.ErrorCode,
                    responseBody.Message, responseBody.Status);
            }
        }
    }

    /**
     * Get available Foundry Orders from the Gun Smith.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    async getFoundryOrders(characterId, accessToken) {
        const vendor = await this.cacheService.getVendor(gunSmithHash);
        const now = (new Date()).toISOString();
        const { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        } else {
	        const { data: responseBody } = await axios({
                headers: {
                    authorization: 'Bearer ' + accessToken,
                    'x-api-key': apiKey
                },
                method: 'get',
                url: `${servicePlatform}/Destiny/2/MyAccount/Character/${characterId}/Vendor/${gunSmithHash}/`
            });

            if (responseBody.ErrorCode === 1) {
	            const { Response: { data }} = responseBody;

	            if (data) {
		            const {vendorHash, nextRefreshDate, saleItemCategories} = data;
		            const foundryOrdersCategory = saleItemCategories
			            .find(saleItemCategory => saleItemCategory.categoryTitle === 'Foundry Orders');
		            const foundryOrders = (typeof foundryOrdersCategory === 'object') ?
			            foundryOrdersCategory.saleItems : [];
		            const itemHashes = foundryOrders.map(saleItem => {
			            const {item: {itemHash}} = saleItem;

			            return itemHash;
		            });

		            const vendor = {
			            vendorHash,
			            nextRefreshDate,
			            itemHashes
		            };

		            this.cacheService.setVendor(vendor);

		            return vendor;
	            } else {
		            return [];
	            }
            }
        }
    }

    /**
     * Get character's inventory.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getInventory(characterId, membershipId, membershipType, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: '${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Inventory/'
        });

        if (responseBody.ErrorCode !== 1) {
            throw new DestinyError(responseBody.ErrorCode || -1,
                responseBody.Message || '', responseBody.ErrorStatus || '');
        } else {
            const character = responseBody.Response.data;

            return character;
        }
    }

    /**
     * Get available Iron Banner Event rewards from Lord Saladin.
     * @param characterId
     * @param accessToken
     * @returns {Array}
     */
    async getIronBannerEventRewards(characterId, membershipType, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: '${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendor/${lordSaladinHash}/'
        });

        if (responseBody.ErrorCode === 1627) {
            return [];
        } else if (responseBody.ErrorCode !== 1) {
            throw new DestinyError(responseBody.ErrorCode ||
                -1, responseBody.Message || '',
                responseBody.ErrorStatus || '');
        } else {
            const data = responseBody.Response.data;

            if (data) {
                const saleItemCategories = data.saleItemCategories;
                const eventRewards = _.find(saleItemCategories, function (saleItemCategory) {
                    return saleItemCategory.categoryTitle === 'Event Rewards';
                });

                this.cacheService.set('getIronBannerEventRewards', eventRewards.saleItems);

                return eventRewards.saleItems;
            } else {
                return [];
            }
        }
    }

    /**
     * Get item from hash.
     * @param itemHash
     * @param accessToken
     * @returns {Promise}
     */
    async getItem(itemHash, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: `${servicePlatform}/Destiny/Manifest/2/${itemHash}/`
        });

        if (responseBody.ErrorCode !== 1) {
            throw new DestinyError(responseBody.ErrorCode || -1,
                responseBody.Message || '', responseBody.ErrorStatus || '');
        } else {
            return responseBody;
        }
    }

    /**
     * Get the lastest Destiny Manifest definition.
     * @param noCache
     * @returns {Promise}
     */
    async getManifest(noCache) {
        const manifest = await this.cacheService.getManifest();

        if (!noCache && manifest) {
            return manifest;
        } else {
	        const { data: responseBody } = await axios({
                headers: {
                    'x-api-key': apiKey
                },
                method: 'get',
                url: `${servicePlatform}/Destiny/Manifest`
            });

            const { Response: manifest } = responseBody;

            this.cacheService.setManifest(manifest);

            return manifest;
        }
    }

    /**
     * Get character progression.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getProgression(characterId, membershipId, membershipType, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: '${servicePlatform}/Destiny/${membershipType}/Account/${membershipId}/Character/${characterId}/Progression/'
        });
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
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: '${servicePlatform}/Destiny/${membershipType}/MyAccount/Character/${characterId}/Vendors/Summaries/'
        });

        if (responseBody.ErrorCode !== 1) {
            throw new DestinyError(responseBody.ErrorCode ||
                -1, responseBody.Message || '',
                responseBody.ErrorStatus || '');
        } else {
            const { Response: { data }} = responseBody;

            return data ? resolve(data.vendors) : [];
        }
    }

    /**
     * Get character's weapons.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    async getWeapons(characterId, membershipId, membershipType, accessToken) {
	    const { data: responseBody } = await axios({
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            method: 'get',
            url: '${servicePlatform}/Destiny/stats/uniqueweapons/${membershipType}/${membershipId}/${characterId}/'
        });

        const { Response: { data: { weapons }}} = responseBody;

        return weapons.sort(function (a, b) {
            if (a.values.uniqueWeaponKillsPrecisionKills.basic.value <
                b.values.uniqueWeaponKillsPrecisionKills.basic.value) {

                return -1;
            }
            if (a.values.uniqueWeaponKillsPrecisionKills.basic.value >
                b.values.uniqueWeaponKillsPrecisionKills.basic.value) {

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
        const vendor = await this.cacheService.getVendor(xurHash);
        const now = (new Date()).toISOString();
        const { nextRefreshDate } = vendor || {};

        if (vendor && nextRefreshDate > now) {
            return vendor;
        } else {
	        const { data: responseBody } = await axios({
                headers: {
                    'x-api-key': apiKey
                },
                method: 'get',
                url: `${servicePlatform}/Destiny/Advisors/Xur/`
            });

            if (responseBody.ErrorCode === 1627) {
                return [];
            } else if (responseBody.ErrorCode !== 1) {
                throw new DestinyError(responseBody.ErrorCode ||
                    -1, responseBody.Message || '',
                    responseBody.ErrorStatus || '');
            } else {
                const { Response: { data }} = responseBody;

                if (data) {
                    const { vendorHash, nextRefreshDate, saleItemCategories } = data;
                    const exotics = saleItemCategories.find((saleItemCategory) => {
                        return saleItemCategory.categoryTitle === 'Exotic Gear';
                    });
                    const itemHashes = exotics.saleItems.map((saleItem) => {
                        const { item: { itemHash }} = saleItem;

                        return itemHash;
                    });
                    const vendor = {
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    };

                    this.cacheService.setVendor(vendor);

                    return vendor;
                } else {
                    return [];
                }
            }
        }
    }
}

module.exports = DestinyService;
