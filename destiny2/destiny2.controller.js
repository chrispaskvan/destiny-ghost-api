/**
 * A module for handling Destiny 2 routes.
 *
 * @module destinyController
 * @author Chris Paskvan
 */
const DestinyController = require('../destiny/destiny.controller');

/**
 * Destiny Controller Service
 */
class Destiny2Controller extends DestinyController {
    /**
     * Get characters for the current user.
     *
     * @returns {*|Array}
     */
    async getCharacters(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny
            .getProfile(currentUser.membershipId, membershipType, true);

        return Promise.all(characters.map(async character => {
            const {
                emblemBackgroundPath: backgroundPath,
                characterId,
                classHash,
                light: powerLevel,
                emblemPath: emblem,
            } = character;
            const {
                displayProperties: {
                    name: className,
                },
            } = await this.world.getClassByHash(classHash);

            return {
                characterId,
                classHash,
                className,
                emblem,
                backgroundPath,
                powerLevel,
                links: [
                    {
                        rel: 'Character',
                        href: `/characters/${characterId}`,
                    },
                ],
            };
        }));
    }

    /**
     * Get the complete list of items.
     *
     * @returns Promise
     * @memberof Destiny2Controller
     */
    getInventory() {
        return Promise.resolve(this.world.items);
    }

    /**
     * Get the current manifest definition from Bungie.
     *
     * @returns Promise
     * @memberof Destiny2Controller
     */
    getManifest() {
        return this.destiny.getManifest();
    }

    /**
     * Search for the Destiny player.
     *
     * @param {*} displayName
     * @returns Promise
     * @memberof Destiny2Controller
     */
    async getPlayer(displayName) {
        const { membershipId, membershipType } = await this.destiny.getPlayer(displayName);

        if (!membershipId || !membershipType) {
            return undefined;
        }

        return this.destiny.getPlayerStats(membershipId, membershipType);
    }

    /**
     * Get Xur's inventory.
     *
     * @returns {*|Array}
     * @private
     */
    async getXur(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const { bungie: { access_token: accessToken }, membershipId } = currentUser;
        const characters = await this.destiny.getProfile(membershipId, membershipType);

        if (characters && characters.length) {
            const itemHashes = await this.destiny.getXur(
                membershipId, membershipType, characters[0].characterId, accessToken,
            );

            if (!itemHashes.length) {
                return itemHashes;
            }

            const items = await Promise.all(
                itemHashes.map(itemHash => this.world.getItemByHash(itemHash)),
            );

            return items;
        }

        return undefined;
    }
}

module.exports = Destiny2Controller;
