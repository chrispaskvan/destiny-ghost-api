import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import configuration from './helpers/config.js';
import log from './helpers/log.js';
import World2 from './helpers/world2.js';
import pool from './helpers/pool.js';

let server;
let generation = 0;

const createGetAllHandler = world => (call, callback) => {
    for (const [key, value1] of Object.entries(configuration.notificationHeaders)) {
        const [value2] = call.metadata.get(key);

        if (value1 !== value2) {
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: `Invalid or missing metadata for "${key}".`,
            });
        }
    }

    const items = world.items;

    if (!items?.length) {
        return callback({
            code: grpc.status.UNAVAILABLE,
            message: 'No items are currently available.',
        });
    }

    const page = call.request.page ?? 1;
    const size = call.request.size ?? 11;

    if (page < 1 || size < 1) {
        return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'page and size must be greater than or equal to 1.',
        });
    }

    const pages = Math.ceil(items.length / size);

    if (page > pages) {
        return callback({
            code: grpc.status.OUT_OF_RANGE,
            message: `Requested page ${page} exceeds available pages (${pages}).`,
        });
    }

    const data = items.slice((page - 1) * size, page * size);

    callback(null, {
        data,
        links: {
            next_page: page < pages ? String(page + 1) : '',
        },
        page: {
            size,
            total: items.length,
            pages,
            number: page,
        },
    });
};

/**
 * Resolve once the port is bound, so callers can await a listening server.
 * @returns {Promise<void>}
 */
const startServer = () =>
    new Promise((resolve, reject) => {
        const packageDefinition = protoLoader.loadSync('./items.proto', {
            keepCase: true,
            longs: String,
            enums: String,
            arrays: true,
        });
        const itemsProto = grpc.loadPackageDefinition(packageDefinition);
        const directory = process.env.DESTINY2_DATABASE_DIR;
        const world = new World2({
            directory,
            pool,
        });
        const port = 1102;

        const attempt = generation;
        const pending = new grpc.Server();
        pending.addService(itemsProto.ItemService.service, {
            getAll: createGetAllHandler(world),
        });

        pending.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), err => {
            if (err) {
                reject(err);
                return;
            }

            /**
             * grpc-js only registers a listening server inside its own bind callback, so a
             * shutdown that ran while this bind was in flight found no server to drain.
             * Close this one here rather than leave it listening with nothing able to
             * reach it. Comparing against a per-attempt token rather than a shared flag
             * keeps a later startServer() from adopting an earlier attempt's server.
             */
            if (attempt !== generation) {
                pending.forceShutdown();
                log.warn('GRPC server bound after shutdown; closing it immediately');
                resolve();
                return;
            }

            server = pending;
            log.info({ port }, 'GRPC server is listening');
            resolve();
        });
    });

/**
 * Drain active RPCs, forcing shutdown if the grace period expires.
 * @returns {Promise<void>}
 */
const stopServer = () =>
    new Promise(resolve => {
        generation += 1;

        if (!server) {
            resolve();
            return;
        }

        const currentServer = server;
        let completed = false;
        const finish = (timedOut = false) => {
            if (completed) return;
            completed = true;
            clearTimeout(timeout);

            if (timedOut) {
                log.warn('GRPC graceful shutdown timed out; forcing shutdown');
                currentServer.forceShutdown();
            } else {
                log.info('GRPC server shut down');
            }

            if (server === currentServer) server = undefined;
            resolve();
        };
        const timeout = setTimeout(() => finish(true), 3000);

        currentServer.tryShutdown(() => finish());
    });

export { createGetAllHandler, startServer, stopServer };
