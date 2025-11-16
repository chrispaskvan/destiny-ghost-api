import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StatusCodes } from 'http-status-codes';

import DestinyError from '../destiny/destiny.error.js';
import ResponseError from '../helpers/response.error.js';
import Routes from './routes.js';
import expressLoader from './express.js';
import hook from '../helpers/performance.js';
import log from '../helpers/log.js';

const loaders = {
    init: async ({ app }) => {
        /**
         * Check that the database directories exist.
         */
        const databases = [path.normalize(process.env.DESTINY_DATABASE_DIR),
            path.normalize(process.env.DESTINY2_DATABASE_DIR)];

        log.info(`DESTINY_DATABASE_DIR=${databases[0]},DESTINY2_DATABASE_DIR=${databases[1]}`);
        if (databases.map(database => database[0]).includes('.')) {
            throw new Error('Illegal path supplied.');
        }
        databases.forEach(database => {
            const directories = database.split('/');

            directories.reduce((directory, folder) => {
                const directoryPath = directory + folder;

                if (!existsSync(directoryPath)) {
                    mkdirSync(directoryPath);
                }

                return `${directoryPath}/`;
            }, '');
        });

        expressLoader(app);

        /**
         * Routes
         */
        const { manifests, routes } = Routes();

        app.use('/', routes);

        /**
         * Performance Hook
         */
        if (process.env.NODE_ENV === 'development') {
            hook.enable();
        }

        /**
         * Check for the latest manifest definition and database from Bungie.
         */
        manifests.upsertManifests();

        app.get('/', (req, res) => {
            if (process.env.NODE_ENV === 'development' && !req.secure) {
                res.redirect(301, `https://api2.destiny-ghost.com${req.url}`);

                return;
            }

            const fileName = fileURLToPath(import.meta.url);
            const directory = path.dirname(fileName);

            res.sendFile(path.join(`${directory}/../signIn.html`));
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

            if (res.status) {
                if (err instanceof DestinyError) {
                    res.status(StatusCodes.NOT_FOUND).json({
                        errors: [{
                            code,
                            message,
                            status,
                        }],
                    });
                } else if (err instanceof ResponseError) {
                    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                        errors: [{
                            status,
                            statusText,
                        }],
                    });
                } else {
                    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
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

export default loaders;
