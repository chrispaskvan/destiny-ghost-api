/**
 * Application Server
 */
import express from 'express';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { createServer as _createServer } from 'https';
import { cpus } from 'os';
import { createTerminus } from '@godaddy/terminus';

import applicationInsights from './helpers/application-insights';
import cache from './helpers/cache';
import loaders from './loaders';
import log from './helpers/log';
import publisher from './helpers/publisher';
import subscriber from './helpers/subscriber';

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
        const server = _createServer({
            ...httpsOptions,
            ...serverOptions,
        }, app);

        secureConnection = server.listen(
            443,
            // eslint-disable-next-line no-console
            () => console.log('HTTPS server listening on port 443.'),
        );
    }

    const insecureServer = createServer(app);

    createTerminus(insecureServer, {
        signals: ['SIGINT', 'SIGTERM'],
        onSignal: async () => {
            // eslint-disable-next-line no-console
            console.log('Interuption or termination signal received. Shutting down the server ...');
            await Promise.all([
                cache.quit(),
                publisher.close(),
                subscriber.close(),
            ]);
            insecureServer.close();
        },
        logger: log.error,
    });

    insecureConnection = insecureServer.listen(port, () => {
        const cpuCount = cpus().length;
        const duration = Date.now() - start;

        applicationInsights.trackMetric({ name: 'Startup Time', value: duration });

        // eslint-disable-next-line no-console
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
