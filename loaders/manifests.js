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
        const manifest = await destiny.getManifest(true);

        await world.updateManifest(manifest);
    }

    /**
     * Update the manifest files for Destiny and Destiny 2.
     *
     * @public
     * @returns {Promise<void>}
     */
    async upsertManifests() {
        await Promise.allSettled([
            this.constructor.#upsertManifest(this.destinyService, this.worldRepository),
            this.constructor.#upsertManifest(this.destiny2Service, this.world2Repository),
        ]);
    }
}

export default Manifests;
