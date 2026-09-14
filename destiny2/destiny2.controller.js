// @ts-check
/**
 * A module for handling Destiny 2 routes.
 *
 * @module destinyController
 * @author Chris Paskvan
 */
import DestinyController from '../destiny/destiny.controller.js';

/** @typedef {import('./destiny2.cache.js').Destiny2Character} Destiny2Character */

/**
 * A character summary flattened from a Bungie profile character and its
 * manifest class definition, as returned by getCharacters().
 * @typedef {Object} CharacterSummary
 * @property {string} characterId
 * @property {number} classHash
 * @property {string} className
 * @property {string} emblem
 * @property {string} backgroundPath
 * @property {number} powerLevel
 * @property {{ rel: string, href: string }[]} links
 */

/**
 * Destiny Controller Service
 * @extends {DestinyController<import('./destiny2.service.js').default, import('../helpers/world2.js').default>}
 */
class Destiny2Controller extends DestinyController {
    /**
     * Get characters for the current user.
     *
     * @param {string} displayName
     * @param {number} membershipType
     * @returns {Promise<CharacterSummary[]>}
     */
    async getCharacters(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);

        if (!currentUser) {
            throw new Error('User is not registered.');
        }

        const characters = await this.destiny.getProfile(
            currentUser.membershipId,
            membershipType,
            true,
        );

        return Promise.all(
            characters.map(async (/** @type {Destiny2Character} */ character) => {
                const {
                    emblemBackgroundPath: backgroundPath,
                    characterId,
                    classHash,
                    light: powerLevel,
                    emblemPath: emblem,
                } = character;
                const classDefinition = await this.world.getClassByHash(classHash);
                const { displayProperties: { name: className = '' } = {} } = classDefinition ?? {};

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
            }),
        );
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
     * @param {boolean} [skipCache]
     * @returns Promise
     * @memberof Destiny2Controller
     */
    async getManifest(skipCache) {
        return await this.destiny.getManifest(skipCache);
    }

    /**
     * Get Xur's inventory.
     *
     * @param {string} displayName - The display name of the user.
     * @param {number} membershipType - The membership type of the user.
     * @param {string} [characterId] - The character ID to use (optional).
     * @returns {Promise<Array<import('../helpers/world2.js').ItemDefinition | undefined> | number[] | undefined>}
     */
    async getXur(displayName, membershipType, characterId) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);

        if (!currentUser?.bungie?.access_token) {
            throw new Error('User is not registered with Bungie.');
        }

        const {
            bungie: { access_token: accessToken },
            membershipId,
        } = currentUser;
        const characters = await this.destiny.getProfile(membershipId, membershipType);

        if (characters?.length) {
            const itemHashes = await this.destiny.getXur(
                membershipId,
                membershipType,
                characterId || characters[0].characterId,
                accessToken,
            );

            if (!itemHashes.length) {
                return itemHashes;
            }

            const items = await Promise.all(
                itemHashes.map(
                    async (/** @type {number} */ itemHash) =>
                        await this.world.getItemByHash(itemHash),
                ),
            );

            return items;
        }

        return undefined;
    }
}

export default Destiny2Controller;
