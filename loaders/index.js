const fs = require('fs');
const path = require('path');

const DestinyError = require('../destiny/destiny.error');
const RequestError = require('../helpers/request.error');
const Routes = require('./routes');
const expressLoader = require('./express');
const httpLog = require('../helpers/httpLog');
const log = require('../helpers/log');


const loaders = {
    init: async ({ app }) => {
        /**
         * Check that the database directories exist.
         */
        const databases = [process.env.DESTINY_DATABASE_DIR, process.env.DESTINY2_DATABASE_DIR];

        databases.forEach(database => {
            const directories = database.split('/');

            directories.reduce((directory, folder) => {
                const directoryPath = directory + folder;

                if (!fs.existsSync(directoryPath)) {
                    fs.mkdirSync(directoryPath);
                }

                return `${directoryPath}/`;
            }, '');
        });

        expressLoader(app);

        /**
         * Request/Response and Error Middleware Loggers
         */
        app.use(httpLog);

        const { manifests, routes } = Routes();

        /**
         * Routes
         */
        app.use('/', routes);

        // noinspection ES6MissingAwait
        /**
         * Check for the latest manifest definition and database from Bungie.
         */
        manifests.upsertManifests();

        app.get('/', (req, res) => {
            if (process.env.NODE_ENV === 'development' && !req.secure) {
                res.redirect(301, `https://api2.destiny-ghost.com${req.url}`);

                return;
            }

            res.sendFile(path.join(`${__dirname}/../signIn.html`));
        });

        app.get('/ping', (req, res) => {
            res.json({
                pong: Date.now(),
            });
        });

        app.use((err, req, res, next) => {
            const {
                code, message, status, statusText,
            } = err;

            log.error(err);
            // noinspection JSUnresolvedVariable
            if (res.status) {
                if (err instanceof DestinyError) {
                    res.status(500).json({
                        errors: [{
                            code,
                            message,
                            status,
                        }],
                    });
                } else if (err instanceof RequestError) {
                    res.status(500).json({
                        errors: [{
                            status,
                            statusText,
                        }],
                    });
                } else {
                    res.status(500).json({
                        errors: [{
                            message,
                        }],
                    });
                }
            } else {
                next(err);
            }
        });
    },
};

module.exports = loaders;
