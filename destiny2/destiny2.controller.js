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
     * Get the current manifest definition from Bungie.
     *
     * @param req
     * @param res
     */
    async getManifest(req, res) {
        const manifest = await this.destiny.getManifest();

        res.status(200).json(manifest);
    }

    /**
     * Search for the Destiny player.
     *
     * @param req
     * @param res
     */
    async getPlayer(req, res) {
        const { params: { displayName } } = req;
        const { membershipId, membershipType } = await this.destiny.getPlayer(displayName);

        if (!membershipId || !membershipType) {
            return res.status(401).end();
        }

        const statistics = await this.destiny.getPlayerStats(membershipId, membershipType);

        return res.status(200).json(statistics);
    }

    /**
     * Get characters for the current user.
     * @returns {*|Array}
     * @private
     */
    async getProfile(req, res) {
        const { session: { displayName, membershipType } } = req;
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

        return res.status(200).json(characterBases);
    }

    /**
     * Get Xur's inventory.
     *
     * @returns {*|Array}
     * @private
     */
    async getXur(req, res) {
        const { session: { displayName, membershipType } } = req;
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const { bungie: { access_token: accessToken }, membershipId } = currentUser;
        const characters = await this.destiny.getProfile(membershipId, membershipType);

        if (characters && characters.length) {
            const itemHashes = await this.destiny.getXur(
                membershipId, membershipType, characters[0].characterId, accessToken,
            );

            if (!itemHashes.length) {
                return res.status(200).json(itemHashes);
            }

            const items = await Promise.all(
                itemHashes.map(itemHash => this.world.getItemByHash(itemHash)),
            );

            return res.status(200).json(items);
        }

        return res.status(404);
    }
}

module.exports = Destiny2Controller;
