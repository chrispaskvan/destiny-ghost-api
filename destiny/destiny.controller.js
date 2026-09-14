// @ts-check
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * `base64url`'s own .d.ts declares an ESM `export default`, but it's a CJS
 * package - under this project's module resolution (no esModuleInterop)
 * that makes TypeScript see the whole module namespace instead of the
 * callable function. `require` sidesteps the mistyped default import.
 * @type {import('base64url').Base64Url}
 */
const base64url = createRequire(import.meta.url)('base64url');

/**
 * Constructor options for DestinyController. Generic over the destiny
 * service and world repository so subclasses (e.g. Destiny2Controller) can
 * specialize them to their own Destiny 2-flavored equivalents.
 * @template {import('./destiny.service.js').default} [TDestinyService=import('./destiny.service.js').default]
 * @template {import('../helpers/world.js').default} [TWorldRepository=import('../helpers/world.js').default]
 * @typedef {Object} DestinyControllerOptions
 * @property {TDestinyService} destinyService
 * @property {import('../users/user.service.js').default} userService
 * @property {TWorldRepository} worldRepository
 */

/**
 * Controller class for Destiny routes.
 * @template {import('./destiny.service.js').default} [TDestinyService=import('./destiny.service.js').default]
 * @template {import('../helpers/world.js').default} [TWorldRepository=import('../helpers/world.js').default]
 */
class DestinyController {
    /**
     * @constructor
     * @param {DestinyControllerOptions<TDestinyService, TWorldRepository>} options
     */
    constructor(options) {
        this.destiny = options.destinyService;
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Get a random state.
     *
     * @returns {string}
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
     * @param {string} displayName
     * @param {number} membershipType
     * @returns {Promise<import('../destiny/destiny.service.js').CurrentUser>}
     */
    async getCurrentUser(displayName, membershipType) {
        const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);

        if (!currentUser?.bungie?.access_token) {
            throw new Error('User is not registered with Bungie.');
        }

        return await this.destiny.getCurrentUser(currentUser.bungie.access_token);
    }

    /**
     * Get a random selection of Grimoire Cards.
     *
     * @param {number} numberOfCards
     * @returns {Promise<*>}
     */
    async getGrimoireCards(numberOfCards) {
        return await this.world.getGrimoireCards(numberOfCards);
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
        const {
            data: { manifest },
        } = await this.destiny.getManifest(true);

        return await this.world.updateManifest(manifest);
    }
}

export default DestinyController;
