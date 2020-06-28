/**
 * Application Server
 */
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const { createTerminus } = require('@godaddy/terminus');

const applicationInsights = require('./helpers/application-insights');
const cache = require('./helpers/cache');
const loaders = require('./loaders');
const log = require('./helpers/log');

async function startServer() {
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
            key: fs.readFileSync('./security/_wildcard.destiny-ghost.com-key.pem'),
            cert: fs.readFileSync('./security/_wildcard.destiny-ghost.com.pem'),
        };
        const server = https.createServer({
            ...httpsOptions,
            ...serverOptions,
        }, app);

        server.listen(443,
            // eslint-disable-next-line no-console
            () => console.log('HTTPS server listening on port 443.'));
    }

    const insecureServer = http.createServer(app);

    createTerminus(insecureServer, {
        signals: ['SIGINT', 'SIGTERM'],
        onSignal: () => (new Promise(resolve => {
            cache.quit(err => {
                resolve(err);
            });
        })),
        logger: log,
    });

    insecureServer.listen(port, () => {
        const cpuCount = os.cpus().length;
        const duration = Date.now() - start;

        applicationInsights.trackMetric({ name: 'Startup Time', value: duration });

        // eslint-disable-next-line no-console
        console.log(`HTTP server listening on port ${port} with ${cpuCount} cpus.`);
    });

    insecureServer.headersTimeout = serverOptions.headersTimeout;
    insecureServer.keepAliveTimeout = serverOptions.keepAliveTimeout;
}

startServer()
    .catch(err => {
        // eslint-disable-next-line no-console
        console.log(err);
        process.exit(1);
    });
