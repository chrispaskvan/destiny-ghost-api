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
    static #getRandomState() {
        return base64url(crypto.randomBytes(11));
    }

    /**
     * Get the authorization URL for Bungie application.
     *
     * @param req
     * @param res
     */
    async getAuthorizationUrl() {
        const state = this.constructor.#getRandomState();
        const url = await this.destiny.getAuthorizationUrl(state);

        return { state, url };
    }

    /**
     * Get the current user from Bungie.
     *
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    async getCurrentUser(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const { bungie: { access_token: accessToken } } = currentUser;

        return this.destiny.getCurrentUser(accessToken);
    }

    /**
     * Get a random selection of Grimoire Cards.
     *
     * @param req
     * @param res
     * @returns {*}
     */
    getGrimoireCards(numberOfCards) {
        return this.world.getGrimoireCards(numberOfCards);
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
     * Insert or update the Destiny manifest if needed.
     */
    async upsertManifest() {
        const manifest = await this.destiny.getManifest(true);

        return this.world.updateManifest(manifest);
    }
}

module.exports = DestinyController;
