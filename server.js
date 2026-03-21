/**
 * Application Server
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { createTerminus } from '@godaddy/terminus';

import applicationInsights from './helpers/application-insights.js';
import cache from './helpers/cache.js';
import jobs from './helpers/jobs.js';
import loaders from './loaders/index.js';
import subscriber from './helpers/subscriber.js';
import processExternalPromisesWithTimeout from './helpers/process-external-promises-with-timeout.js';
import pool from './helpers/pool.js';

let insecureConnection;
let secureConnection;

const startServer = async () => {
    const start = performance.now();
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
            console.log('Interruption or termination signal received. Shutting down the server ...');

            const shutdownTasks = [
                ['Cache', cache.quit()],
                ['Job queue', jobs.quit()],
                ['Worker pool', pool.close()],
                ['Subscriber', subscriber.close()],
            ];
            const results = await processExternalPromisesWithTimeout(
                shutdownTasks.map(([, task]) => task),
                3000,
            );

            shutdownTasks.forEach(([label], index) => {
                const result = results[index];

                if (result.status === 'fulfilled') {
                    console.log(`${label} shut down`);
                } else if (result.status === 'timed-out') {
                    console.error(`${label} failed to shut down in time`);
                } else {
                    console.error(`${label} failed to shut down`, result.reason);
                }
            });

            insecureServer.close();
        },
        logger: console.error,
    });

    insecureConnection = insecureServer.listen(port, () => {
        const cpuCount = cpus().length;
        const duration = Math.round(performance.now() - start);

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
