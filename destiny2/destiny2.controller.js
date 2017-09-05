/**
 * A module for handling Destiny routes..
 *
 * @module destinyController
 * @author Chris Paskvan
 * @requires _
 * @requires Destiny
 * @requires fs
 * @requires Ghost
 * @requires jSend
 * @requires Q
 * @requires request
 * @requires S
 * @requires User
 * @requires World
 * @requires yauzl
 */
var _ = require('underscore'),
    fs = require('fs'),
    log = require('../helpers/log'),
    request = require('request'),
    yauzl = require('yauzl');
/**
 * Destiny Controller
 * @param options
 * @constructor
 */
/**
 * @namespace
 * @type {{getCharacters, getCurrentUser, getFieldTestWeapons, getFoundryOrders, getIronBannerEventRewards,
 * getXur, upsertManifest}}
 */
class Destiny2Controller {
    constructor(options) {
        this.destiny = options.destiny2Service;
    }

    getManifest(req, res) {
        this.destiny.getManifest()
            .then(manifest => {
                res.status(200).json(manifest).end();
            });
    }

    upsertManifest(req, res) {
        this.destiny.getManifest()
            .then(manifest => {
                return this.destiny.getManifest(true)
                    .then(latestManifest => {
                        const databasePath = './databases/';
                        const { mobileWorldContentPaths: { en: relativeUrl }}  = latestManifest;
                        const fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

                        if (!latestManifest || latestManifest.version !== manifest.version ||
                                latestManifest.mobileWorldContentPaths.en !== manifest.mobileWorldContentPaths.en ||
                                !fs.existsSync(fileName)) {
                            const file = fs.createWriteStream(fileName + '.zip');
                            const stream = request('https://www.bungie.net' + relativeUrl, () => {
                                log.info('content downloaded from ' + relativeUrl);
                            }).pipe(file);

                            stream.on('finish', () => {
                                yauzl.open(fileName + '.zip', (err, zipFile) => {
                                    if (!err) {
                                        zipFile.on('entry', entry => {
                                            zipFile.openReadStream(entry, (err, readStream) => {
                                                if (!err) {
                                                    readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));

                                                    fs.unlink(fileName + '.zip', () => {});

                                                    res.status(204).end();
                                                } else {
                                                    throw err;
                                                }
                                            });
                                        });
                                    } else {
                                        throw err;
                                    }
                                });
                            });
                        } else {
                            res.status(304).end();
                        }
                    });
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }
}

module.exports = Destiny2Controller;
