/**
 * Application Server
 */
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { createServer as createSecureServer } from 'https';
import { cpus } from 'os';
import express from 'express';
import { createTerminus } from '@godaddy/terminus';

import applicationInsights from './helpers/application-insights';
import cache from './helpers/cache';
import jobs from './helpers/jobs';
import loaders from './loaders';
import log from './helpers/log';
import subscriber from './helpers/subscriber';
import processExternalPromisesWithTimeout from './helpers/process-external-promises-with-timeout';
import pool from './helpers/pool';

let insecureConnection;
let secureConnection;

const startServer = async () => {
    const start = Date.now();
    const app = express();

    await loaders.init({ app });

    /**
     * Server(s)
     * {@link https://shuheikagawa.com/blog/2019/04/25/keep-alive-timeout/}
     */
    const port = process.env.PORT;
    const serverOptions = {
        headersTimeout: 65 * 1000,
        keepAliveTimeout: 61 * 1000,
    };

    if (process.env.NODE_ENV === 'development') {
        const httpsOptions = {
            key: readFileSync('./security/_wildcard.destiny-ghost.com-key.pem'),
            cert: readFileSync('./security/_wildcard.destiny-ghost.com.pem'),
        };
        const server = createSecureServer({
            ...httpsOptions,
            ...serverOptions,
        }, app);

        secureConnection = server.listen(
            443,
            () => console.log('HTTPS server listening on port 443.'),
        );
    }

    const insecureServer = createServer(app);

    createTerminus(insecureServer, {
        signals: ['SIGINT', 'SIGTERM'],
        onSignal: async () => {
            console.log('Interuption or termination signal received. Shutting down the server ...');
            await processExternalPromisesWithTimeout([
                cache.quit(),
                jobs.quit(),
                pool.close(),
                subscriber.close(),
            ], 3000);
            insecureServer.close();
        },
        logger: log.error.bind(log),
    });

    insecureConnection = insecureServer.listen(port, () => {
        const cpuCount = cpus().length;
        const duration = Date.now() - start;

        applicationInsights.trackMetric({ name: 'startup-time', value: duration });

        console.log(`HTTP server listening on port ${port} with ${cpuCount} cpus.`);
    });

    insecureServer.headersTimeout = serverOptions.headersTimeout;
    insecureServer.keepAliveTimeout = serverOptions.keepAliveTimeout;

    return insecureServer.address();
};

const stopServer = () => new Promise(resolve => {
    if (insecureConnection) {
        insecureConnection.close();
    }
    if (secureConnection) {
        secureConnection.close();
    }

    resolve();
});

export {
    startServer,
    stopServer,
};
