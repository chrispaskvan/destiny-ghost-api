const _ = require('underscore');
const base64url = require('base64url');
const crypto = require('crypto');

/**
 * Controller class for Destiny routes.
 */
class DestinyController {
    /**
     * @constructor
     * @param options
     */
    constructor(options = {}) {
        this.destiny = options.destinyService;
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Get a random state.
     *
     * @returns {*}
     * @private
     */
    static getRandomState() {
        return base64url(crypto.randomBytes(11));
    }

    /**
     * Get the authorization URL for Bungie application.
     *
     * @param req
     * @param res
     */
    async getAuthorizationUrl(req, res) {
        const state = this.constructor.getRandomState();

        req.session.state = state;

        const url = await this.destiny.getAuthorizationUrl(state);

        res.send(url);
    }

    /**
     * Get characters for the current user.
     *
     * @returns {*|Array}
     */
    async getCharacters(req, res) {
        const { session: { displayName, membershipType } } = req;
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

        res.json(characterBases);
    }

    /**
     * Get a random selection of Grimoire Cards.
     *
     * @param req
     * @param res
     * @returns {*}
     */
    async getGrimoireCards(req, res) {
        const numberOfCards = parseInt(req.params.numberOfCards, 10);

        if (Number.isNaN(numberOfCards)) {
            return res.status(422).end();
        }

        const grimoireCards = await this.world.getGrimoireCards(numberOfCards);

        return res.status(200).json(grimoireCards);
    }

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
     * Insert or update the Destiny manifest if needed.
     */
    async upsertManifest(req, res) {
        const manifest = await this.destiny.getManifest(true);

        await this.world.updateManifest(manifest);

        res.status(200).json(manifest);
    }
}

module.exports = DestinyController;
