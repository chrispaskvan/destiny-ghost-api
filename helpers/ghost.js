/**
 * @class Ghost
 * @requires path
 */
'use strict';
const path = require('path');
/**
 * Ghost Class
 */
class Ghost {
    /**
     *
     * @param databaseFullPath
     * @constructor
     */
    constructor(destinyService) {
        this.destiny = destinyService;
    }
    /**
     * Get the full path to the database.
     * @returns {*|promise}
     */
    getWorldDatabasePath() {
        return this.destiny.getManifest()
            .then(function (manifest) {
                return manifest ?
                    path.join('./databases/', path.basename(manifest.mobileWorldContentPaths.en))
                    : undefined;
            });
    }
}

module.exports = Ghost;
