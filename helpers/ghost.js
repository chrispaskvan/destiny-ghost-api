const EventEmitter = require('events').EventEmitter,
	fs = require('fs'),
	log = require('./log'),
	path = require('path'),
	request = require('request'),
	yauzl = require('yauzl');

/**
 * Ghost Class
 */
class Ghost extends EventEmitter {
	/**
	 * @constructor
	 * @param options
	 * @todo Need to organize Destiny and Destiny2 databases into separate directories.
	 */
	constructor() {
		const [databaseFileName] = fs.readdirSync(process.env.DATABASE)
			.map(name => {
				return {
					name,
					time: fs.statSync(process.env.DATABASE + name).mtime.getTime()
				};
			})
			.sort((a, b) => b.time - a.time)
			.map(file => file.name);

		super();
		this.databaseFileName = databaseFileName;
	}

    /**
     * Get the full path to the database.
     *
     * @returns {Promise}
     */
    getWorldDatabasePath() {
    	return Promise.resolve(this.databaseFileName ?
		    path.join(process.env.DATABASE, path.basename(this.databaseFileName)) : undefined);
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
					if (err) {
						return reject(err);
					}

					zipFile.on('entry', entry => {
						zipFile.openReadStream(entry, (err, readStream) => {
							if (err) {
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
