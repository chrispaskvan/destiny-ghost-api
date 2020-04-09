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
        const { membershipId } = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getCharacters(membershipId, membershipType);
        const characterBases = characters.map(character => {
            const { backgroundPath, characterBase = {}, emblem } = character;

            return {
                characterId: characterBase.characterId,
                classHash: characterBase.classHash,
                emblem,
                backgroundPath,
                powerLevel: characterBase.powerLevel,
                links: [
                    {
                        rel: 'Character',
                        href: `/characters/${characterBase.characterId}`,
                    },
                ],
            };
        });
        const characterClasses = await Promise.all(characterBases
            .map(characterBase => this.world.getClassByHash(characterBase.classHash)));

        characterBases.forEach((characterBase, index) => {
            characterBase.className = characterClasses[index].className; // eslint-disable-line max-len, no-param-reassign
        });

        return characterBases;
    }

    /**
     * Get the current manifest definition from Bungie.
     *
     * @param req
     * @param res
     */
    getManifest() {
        return this.destiny.getManifest();
    }

    /**
     * Search for the Destiny player.
     *
     * @param req
     * @param res
     */
    async getPlayer(displayName) {
        const { membershipId, membershipType } = await this.destiny.getPlayer(displayName);

        if (!membershipId || !membershipType) {
            return undefined;
        }

        return this.destiny.getPlayerStats(membershipId, membershipType);
    }

    /**
     * Get characters for the current user.
     * @returns {*|Array}
     * @private
     */
    async getProfile(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const characters = await this.destiny.getProfile(currentUser.membershipId, membershipType);
        const promises = [];
        const characterBases = characters.map(({
            characterId,
            classHash,
            emblemBackgroundPath,
            emblemPath,
            light,
        }) => {
            promises.push(this.world.getClassByHash(classHash));

            return {
                characterId,
                classHash,
                emblem: emblemPath,
                backgroundPath: emblemBackgroundPath,
                powerLevel: light,
                links: [
                    {
                        rel: 'Character',
                        href: `/characters/${characterId}`,
                    },
                ],
            };
        });
        const characterClasses = await Promise.all(promises);

        characterBases.forEach((characterBase, index) => {
            characterBase.className = characterClasses[index].displayProperties.name; // eslint-disable-line max-len, no-param-reassign
        });

        return characterBases;
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
