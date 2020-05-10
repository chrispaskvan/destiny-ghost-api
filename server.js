/**
 * Application Server
 */
require('dotenv').config();

const applicationInsights = require('applicationinsights');
const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const { createTerminus } = require('@godaddy/terminus');

const loaders = require('./loaders');
const client = require('./helpers/cache');
const { applicationInsights: { instrumentationKey } } = require('./helpers/config');


async function startServer() {
    const start = Date.now();
    const app = express();

    await loaders.init({ app });

    /**
     * Application Insights
     */
    applicationInsights.setup(instrumentationKey).start();

    /**
     * Server(s)
     */
    const port = process.env.PORT;

    if (process.env.NODE_ENV === 'development') {
        const httpsOptions = {
            key: fs.readFileSync('./security/_wildcard.destiny-ghost.com-key.pem'),
            cert: fs.readFileSync('./security/_wildcard.destiny-ghost.com.pem'),
        };
        const server = https.createServer(httpsOptions, app);
        server.listen(443,
            // eslint-disable-next-line no-console
            () => console.log('HTTPS server listening on port 443.'));
    }

    const insecureServer = http.createServer(app);

    createTerminus(insecureServer, {
        signal: 'SIGINT',
        onSignal: () => (new Promise(resolve => {
            client.quit(err => {
                resolve(err);
            });
        })),
    });

    insecureServer.listen(port, () => {
        const cpuCount = os.cpus().length;
        const duration = Date.now() - start;

        applicationInsights.defaultClient.trackMetric({ name: 'Startup Time', value: duration });
        // eslint-disable-next-line no-console
        console.log(`HTTP server listening on port ${port} with ${cpuCount} cpus.`);
    });
}

startServer();
