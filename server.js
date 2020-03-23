/**
 * Application Server
 */
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');

const loaders = require('./loaders');

async function startServer() {
    const app = express();

    await loaders.init({ app });

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

    insecureServer.listen(port,
        // eslint-disable-next-line no-console
        () => console.log(`HTTP server listening on port ${port}`));
}

startServer();
