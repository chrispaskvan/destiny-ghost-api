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
 * @requires _
 * @requires request
 * @requires util
 */
'use strict';
const _ = require('underscore'),
    DestinyError = require('./destiny.error'),
	{ apiKey, authorizationUrl, clientId, clientSecret } = require('../settings/bungie.json'),
    { gunSmithHash, lordSaladinHash, xurHash } = require('./destiny.constants'),
    request = require('request'),
    util = require('util');

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
     * @param cacheService
     */
    constructor(options) {
        this.cacheService = options.cacheService;
    }

    /**
     * Get Bungie access token from code.
     * @param code
     * @returns {Promise}
     */
    getAccessTokenFromCode(code) {
        const opts = {
			body: util.format('client_id=%s&client_secret=%s&grant_type=authorization_code&code=%s',
				clientId, clientSecret, code),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'x-api-key': apiKey
			},
			url: util.format('%s/app/oauth/token/', servicePlatform)
		};

        return new Promise((resolve, reject) => {
            request.post(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    resolve(responseBody);
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Refresh access token with Bungie.
     * @param refreshToken
     */
    getAccessTokenFromRefreshToken(refreshToken) {
        const opts = {
			body: util.format('client_id=%s&client_secret=%s&grant_type=refresh_token&refresh_token=%s',
				clientId, clientSecret, refreshToken),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'x-api-key': apiKey
			},
			url: util.format('%s/app/oauth/token/', servicePlatform)
		};

        return new Promise((resolve, reject) => {
            request.post(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    resolve(responseBody);
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get Bungie App authorization URL.
     * @param state
     * @returns {Promise}
     */
    getAuthorizationUrl(state) {
        return Promise.resolve(util.format('%s?client_id=%s&response_type=code&state=%s', authorizationUrl, clientId, state));
    }

    /**
     * Get Activity of a character.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    getActivity(characterId, membershipId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Activities/',
                servicePlatform, membershipId, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode === 1) {
                        const character = JSON.parse(body).Response;

                        resolve(character);
                    } else {
                        reject(new DestinyError(responseBody.ErrorCode || -1,
                            responseBody.Message || '', responseBody.ErrorStatus || ''));
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get details of a character.
     * @param membershipId
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    getCharacter(membershipId, characterId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Complete/',
                servicePlatform, membershipId, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode === 1) {
                        const character = responseBody.Response.data;

                        resolve(character);
                    } else {
                        reject(new DestinyError(responseBody.ErrorCode || -1,
                            responseBody.Message || '', responseBody.ErrorStatus || ''));
                    }
                } else if (!err && res.statusCode === 99) {
                    reject(new DestinyError(res.statusCode, res.Message));
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get a list of the member's characters.
     * @param membershipId
     * @param membershipType
     * @returns {Promise}
     */
    getCharacters(membershipId, membershipType) {
        const opts = {
            headers: {
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/%s/Account/%s/Summary/', servicePlatform,
                membershipType, membershipId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode === 1) {
                        resolve(responseBody.Response.data.characters);
                    } else {
                        reject(new DestinyError(responseBody.ErrorCode || -1,
                            responseBody.Message || '', responseBody.ErrorStatus || ''));
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get the Bungie member number from the user's display name.
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    getMembershipIdFromDisplayName(displayName, membershipType) {
        const opts = {
            headers: {
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/%s/Stats/GetMembershipIdByDisplayName/%s/',
                servicePlatform, membershipType, encodeURIComponent(displayName))
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    resolve(JSON.parse(body).Response);
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get the current user based on the Bungie access token.
     * @param accessToken
     * @returns {Promise}
     */
    getCurrentUser(accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/User/GetBungieNetUser/', servicePlatform)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, (err, res, body) => {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.Reponse !== undefined || responseBody.ErrorCode !== 1) {
                        reject(new DestinyError(responseBody.ErrorCode, responseBody.Message, responseBody.Status));
                    } else {
                        const user = responseBody.Response;
                        const gamerTag = user.psnId || user.gamerTag;

                        if (!gamerTag) {
                            // ToDo: User may be legitimate w/o gamer tag
                            reject(new Error('Gamer tag not found.'));
                        }

                        const membershipType = user.psnId ? membershipTypes.TigerPsn : membershipTypes.TigerXbox;

                        return this.getMembershipIdFromDisplayName(gamerTag, membershipType)
                            .then(membershipId => {
                                if (user) {
                                    resolve({
                                        displayName: user.psnId,
                                        email: user.email,
                                        membershipId: membershipId,
                                        membershipType: membershipType,
                                        profilePicturePath: user.user.profilePicturePath
                                    });
                                }

                                reject(
                                    new Error('membershipId undefined for the following gamerTag and membershipType: ' +
                                        gamerTag + ',' + membershipType));
                            });
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get available field test weapons from the Gun Smith.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    getFieldTestWeapons(characterId, accessToken) {
        return this.cacheService.getVendor(gunSmithHash)
            .then(vendor => {
                const now = (new Date()).toISOString();
                const { nextRefreshDate } = vendor || {};

                if (vendor && nextRefreshDate > now) {
                    return vendor;
                } else {
                    return new Promise((resolve, reject) => {
                        const opts = {
                            headers: {
                                authorization: 'Bearer ' + accessToken,
                                'x-api-key': apiKey
                            },
                            url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                                servicePlatform, characterId, gunSmithHash)
                        };

                        request.get(opts, (error, res, body) => {
                            if (!error && res.statusCode === 200) {
                                const responseBody = JSON.parse(body);

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
                                        resolve(vendor);
                                    } else {
                                        resolve([]);
                                    }
                                } else {
                                    reject(new DestinyError(responseBody.ErrorCode,
                                        responseBody.Message, responseBody.Status));
                                }
                            } else {
                                reject(error);
                            }
                        });
                    });
                }
            });
    }

    /**
     * Get available Foundry Orders from the Gun Smith.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    getFoundryOrders(characterId, accessToken) {
        return this.cacheService.getVendor(gunSmithHash)
            .then(vendor => {
                const now = (new Date()).toISOString();
                const { nextRefreshDate } = vendor || {};

                if (vendor && nextRefreshDate > now) {
                    return vendor;
                } else {
                    const opts = {
                        headers: {
                            authorization: 'Bearer ' + accessToken,
                            'x-api-key': apiKey
                        },
                        url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                            servicePlatform, characterId, gunSmithHash)
                    };

                    return new Promise((resolve, reject) => {
                        request.get(opts, (error, res, body) => {
                            if (!error && res.statusCode === 200) {
                                const responseBody = JSON.parse(body);

                                if (responseBody.ErrorCode === 1) {
                                    const {Response: {data}} = responseBody;

                                    if (data) {
                                        const { vendorHash, nextRefreshDate, saleItemCategories } = data;
                                        const foundryOrdersCategory = saleItemCategories
                                            .find(saleItemCategory => saleItemCategory.categoryTitle === 'Foundry Orders');
                                        const foundryOrders = (typeof foundryOrdersCategory === 'object') ?
                                            foundryOrdersCategory.saleItems : [];
                                        const itemHashes = foundryOrders.map(saleItem => {
                                            const { item: { itemHash }} = saleItem;

                                            return itemHash;
                                        });

                                        const vendor = {
                                            vendorHash,
                                            nextRefreshDate,
                                            itemHashes
                                        };

                                        this.cacheService.setVendor(vendor);
                                        resolve(vendor);
                                    } else {
                                        resolve([]);
                                    }
                                } else {
                                    reject(new DestinyError(responseBody.ErrorCode,
                                        responseBody.Message, responseBody.Status));
                                }
                            } else {
                                reject(error);
                            }
                        });
                    });
                }
            });
    }

    /**
     * Get character's inventory.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    getInventory(characterId, membershipId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Inventory/',
                servicePlatform, membershipId, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode !== 1) {
                        reject(new DestinyError(responseBody.ErrorCode || -1,
                            responseBody.Message || '', responseBody.ErrorStatus || ''));
                    } else {
                        const character = responseBody.Response.data;

                        resolve(character);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get available Iron Banner Event rewards from Lord Saladin.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    getIronBannerEventRewards(characterId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                servicePlatform, characterId, lordSaladinHash)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode === 1627) {
                        resolve([]);
                    } else if (responseBody.ErrorCode !== 1) {
                        reject(new DestinyError(responseBody.ErrorCode ||
                            -1, responseBody.Message || '',
                            responseBody.ErrorStatus || ''));
                    } else {
                        const data = responseBody.Response.data;

                        if (data) {
                            const saleItemCategories = data.saleItemCategories;
                            const eventRewards = _.find(saleItemCategories, function (saleItemCategory) {
                                return saleItemCategory.categoryTitle === 'Event Rewards';
                            });

                            this.cacheService.set('getIronBannerEventRewards', eventRewards.saleItems);
                            resolve(eventRewards.saleItems);
                        } else {
                            resolve([]);
                        }
                    }
                }
            });
        });
    }

    /**
     * Get item from hash.
     * @param itemHash
     * @param accessToken
     * @returns {Promise}
     */
    getItem(itemHash, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/Manifest/2/%s/', servicePlatform, itemHash)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode !== 1) {
                        reject(new DestinyError(responseBody.ErrorCode || -1,
                            responseBody.Message || '', responseBody.ErrorStatus || ''));
                    } else {
                        resolve(responseBody);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get the lastest Destiny Manifest definition.
     * @param noCache
     * @returns {Promise}
     */
    getManifest(noCache) {
        return this.cacheService.getManifest()
            .then(manifest => {
                if (!noCache && manifest) {
                    return manifest;
                } else {
                    const opts = {
                        headers: {
                            'x-api-key': apiKey
                        },
                        url: util.format('%s/Destiny/Manifest', servicePlatform)
                    };

                    return new Promise((resolve, reject) => {
                        request.get(opts, (err, res, body) => {
                            if (!err && res.statusCode === 200) {
                                const manifest = JSON.parse(body).Response;

                                this.cacheService.setManifest(manifest);

                                resolve(manifest);
                            } else {
                                reject(err);
                            }
                        });
                    });
                }
            });
    }

    /**
     * Get character progression.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    getProgression(characterId, membershipId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Progression/',
                servicePlatform, membershipId, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const character = JSON.parse(body).Response;

                    resolve(character);
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get vendor summaries for a character.
     * @param characterId
     * @param accessToken
     * @returns {Promise}
     */
    getVendorSummaries(characterId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendors/Summaries/',
                servicePlatform, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const responseBody = JSON.parse(body);

                    if (responseBody.ErrorCode !== 1) {
                        reject(new DestinyError(responseBody.ErrorCode ||
                            -1, responseBody.Message || '',
                            responseBody.ErrorStatus || ''));
                    } else {
                        const data = responseBody.Response.data;

                        return data ? resolve(data.vendors) : resolve([]);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get character's weapons.
     * @param characterId
     * @param membershipId
     * @param accessToken
     * @returns {Promise}
     */
    getWeapons(characterId, membershipId, accessToken) {
        const opts = {
            headers: {
                authorization: 'Bearer ' + accessToken,
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny/stats/uniqueweapons/2/%s/%s/',
                servicePlatform, membershipId, characterId)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, function (err, res, body) {
                if (!err && res.statusCode === 200) {
                    const {Response: {data: {weapons}}} = body;

                    resolve(weapons.sort(function (a, b) {
                        if (a.values.uniqueWeaponKillsPrecisionKills.basic.value <
                            b.values.uniqueWeaponKillsPrecisionKills.basic.value) {

                            return -1;
                        }
                        if (a.values.uniqueWeaponKillsPrecisionKills.basic.value >
                            b.values.uniqueWeaponKillsPrecisionKills.basic.value) {

                            return 1;
                        }

                        return 0;
                    }));
                } else {
                    reject(err);
                }
            });
        });
    }

	/**
     * Get the exotic gear and weapons available for sale from Xur.
	 * @returns {Promise}
	 */
	getXur() {
        return this.cacheService.getVendor(xurHash)
            .then(vendor => {
                const now = (new Date()).toISOString();
                const { nextRefreshDate } = vendor || {};

                if (vendor && nextRefreshDate > now) {
                    return vendor;
                } else {
                    const opts = {
                        headers: {
                            'x-api-key': apiKey
                        },
                        url: util.format('%s/Destiny/Advisors/Xur/', servicePlatform)
                    };

                    return new Promise((resolve, reject) => {
                        request.get(opts, (err, res, body) => {
                            if (!err && res.statusCode === 200) {
                                const responseBody = JSON.parse(body);

                                if (responseBody.ErrorCode === 1627) {
                                    resolve([]);
                                } else if (responseBody.ErrorCode !== 1) {
                                    reject(new DestinyError(responseBody.ErrorCode ||
                                        -1, responseBody.Message || '',
                                        responseBody.ErrorStatus || ''));
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
                                        resolve(vendor);
                                    } else {
                                        resolve([]);
                                    }
                                }
                            } else {
                                reject(err);
                            }
                        });
                    });
                }
            });
    }
}

module.exports = DestinyService;
