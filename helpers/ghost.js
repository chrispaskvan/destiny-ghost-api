const fs = require('fs'),
	log = require('./log'),
	path = require('path'),
	request = require('request'),
	yauzl = require('yauzl');

/**
 * Ghost Class
 */
class Ghost {
	/**
	 * @constructor
	 * @param options
	 */
	constructor(options = {}) {
        this.destiny = options.destinyService;
    }

    /**
     * Get the full path to the database.
     *
     * @returns {Promise}
     */
    getWorldDatabasePath() {
        return this.destiny.getManifest()
            .then(this.updateManifest)
            .then(manifest => {
                return manifest ?
                    path.join(process.env.DATABASE, path.basename(manifest.mobileWorldContentPaths.en))
                    : undefined;
            });
    }

	/**
	 * Download and unzip the manifest database.
	 *
	 * @param manifest
	 * @returns {*}
	 */
	updateManifest(manifest) {
		const databasePath = process.env.DATABASE;
		const { mobileWorldContentPaths: { en: relativeUrl }} = manifest;
		const fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

		if (fs.existsSync(fileName)) {
			return Promise.resolve(manifest);
		}

		return new Promise((resolve, reject) => {
			const file = fs.createWriteStream(fileName + '.zip');
			const stream = request('https://www.bungie.net' + relativeUrl, () => {
				log.info('content downloaded from ' + relativeUrl);
			}).pipe(file);

			stream.on('finish', () => {
				yauzl.open(fileName + '.zip', (err, zipFile) => {
					if (!err) {
						return reject(err);
					}

					zipFile.on('entry', entry => {
						zipFile.openReadStream(entry, (err, readStream) => {
							if (!err) {
								return reject(err);
							}

							readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));
							fs.unlink(fileName + '.zip');

							resolve(manifest);
						});
					});
				});
			});
		});
	}
}

module.exports = Ghost;
