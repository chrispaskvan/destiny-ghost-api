import log from '../helpers/log.js';

class Manifests {
    constructor({
        destinyService,
        destiny2Service,
        worldRepository,
        world2Repository,
    }) {
        this.destinyService = destinyService;
        this.destiny2Service = destiny2Service;
        this.worldRepository = worldRepository;
        this.world2Repository = world2Repository;
    }

    /**
     * Download the latest and greatest manifest file if needed.
     *
     * @param destiny
     * @param world
     * @returns {Promise<void>}
     * @private
     */
    static async #upsertManifest(destiny, world) {
        const { data: { manifest } } = await destiny.getManifest(true);

        await world.updateManifest(manifest);
    }

    /**
     * Update the manifest files for Destiny and Destiny 2.
     *
     * @public
     * @returns {Promise<void>}
     */
    async upsertManifests() {
        const results = await Promise.allSettled([
            Manifests.#upsertManifest(this.destinyService, this.worldRepository),
            Manifests.#upsertManifest(this.destiny2Service, this.world2Repository),
        ]);

        results.forEach(({ status, value, reason }, index) => {
            if (status === 'fulfilled') {
                log.info({ value }, `Destiny ${index ? '2 ' : ''}manifest updated.`);
            } else {
                log.error({ reason: reason.message }, `Destiny ${index ? '2 ' : ''}manifest update failed.`);
            }
        });
    }
}

export default Manifests;
