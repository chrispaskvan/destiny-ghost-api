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
import { readStartupEventLoopDelay } from './helpers/event-loop-delay.js';
import cache from './helpers/cache.js';
import jobs from './helpers/jobs.js';
import log from './helpers/log.js';
import loaders from './loaders/index.js';
import subscriber from './helpers/subscriber.js';
import processExternalPromisesWithTimeout from './helpers/process-external-promises-with-timeout.js';
import pool from './helpers/pool.js';
import { startServer as startGrpcServer, stopServer as stopGrpcServer } from './grpc.js';

let insecureConnection;
let secureConnection;

/**
 * @param {{ grpc?: boolean }} [options] - also start the gRPC server, sharing
 * the REST API's manifest; start.js does, the integration tests do not
 */
const startServer = async ({ grpc = false } = {}) => {
    const start = performance.now();
    const app = express();
    const { world2 } = await loaders.init({ app });

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
        const server = createSecureServer(
            {
                ...httpsOptions,
                ...serverOptions,
            },
            app,
        );

        secureConnection = server.listen(443, () =>
            log.info({ port: 443 }, 'HTTPS server is listening.'),
        );
    }

    const insecureServer = createServer(app);

    createTerminus(insecureServer, {
        signals: ['SIGINT', 'SIGTERM'],
        onSignal: async () => {
            console.log(
                'Interruption or termination signal received. Shutting down the server ...',
            );

            try {
                await stopGrpcServer();
            } catch (err) {
                log.error({ err }, 'GRPC failed to shut down');
            }

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
        },
        logger: (msg, err) => log.error({ err }, msg),
    });

    insecureConnection = insecureServer.listen(port, async () => {
        const cpuCount = cpus().length;
        const duration = Math.round(performance.now() - start);
        /**
         * `duration` covers only startServer; this also covers loading and
         * evaluating every module before it, where a cold start spends most
         * of its time.
         */
        const sinceProcessStart = Math.round(performance.now());
        /**
         * Reported once, on its own, so /health/metrics only ever reports
         * time the server was listening. Resolves once the loop has turned,
         * since listening can come in the same turn as the startup it covers.
         */
        const eventLoopDelay = await readStartupEventLoopDelay();

        applicationInsights.trackMetric({ name: 'startup-time', value: duration });
        applicationInsights.trackMetric({
            name: 'Startup Event Loop Delay max',
            value: eventLoopDelay.max,
        });

        log.info(
            { port, cpuCount, duration, sinceProcessStart, eventLoopDelay },
            'HTTP server is listening',
        );
    });

    insecureServer.headersTimeout = serverOptions.headersTimeout;
    insecureServer.keepAliveTimeout = serverOptions.keepAliveTimeout;

    if (grpc) {
        await startGrpcServer({ world: world2 });
    }

    return insecureServer.address();
};

const stopServer = () =>
    new Promise(resolve => {
        if (insecureConnection) {
            insecureConnection.close();
        }
        if (secureConnection) {
            secureConnection.close();
        }

        resolve();
    });

export { startServer, stopServer };
