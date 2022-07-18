/* eslint-disable security/detect-non-literal-fs-filename */
import { StatusCodes } from 'http-status-codes';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import DestinyError from '../destiny/destiny.error';
import RequestError from '../helpers/request.error';
import Routes from './routes';
import expressLoader from './express';
import hook from '../helpers/performance';
import log from '../helpers/log';

const loaders = {
    init: async ({ app }) => {
        /**
         * Check that the database directories exist.
         */
        const databases = [process.env.DESTINY_DATABASE_DIR, process.env.DESTINY2_DATABASE_DIR];

        log.info(`DESTINY_DATABASE_DIR=${databases[0]},DESTINY2_DATABASE_DIR=${databases[1]}`);
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
        if (process.env.NODE_DEBUG) {
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
                } else if (err instanceof RequestError) {
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
