import { randomBytes } from 'crypto';
import base64url from 'base64url';

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
        return base64url(randomBytes(11));
    }

    /**
     * Get the authorization URL for Bungie application.
     */
    async getAuthorizationUrl() {
        const state = DestinyController.#getRandomState();
        const url = await this.destiny.getAuthorizationUrl(state);

        return { state, url };
    }

    /**
     * Get the current user from Bungie.
     *
     * @returns {Promise}
     */
    async getCurrentUser(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
        const { bungie: { access_token: accessToken } } = currentUser;

        return await this.destiny.getCurrentUser(accessToken);
    }

    /**
     * Get a random selection of Grimoire Cards.
     *
     * @returns {Promise}
     */
    async getGrimoireCards(numberOfCards) {
        return this.world.getGrimoireCards(numberOfCards);
    }

    /**
     * Get the current manifest definition from Bungie.
     *
     * @param {boolean} skipCache
     */
    async getManifest(skipCache) {
        return await this.destiny.getManifest(skipCache);
    }

    /**
     * Insert or update the Destiny manifest if needed.
     */
    async upsertManifest() {
        const { data: { manifest } } = await this.destiny.getManifest(true);

        return await this.world.updateManifest(manifest);
    }
}

export default DestinyController;
