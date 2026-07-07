import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import configuration from './helpers/config.js';
import log from './helpers/log.js';
import World2 from './helpers/world2.js';
import pool from './helpers/pool.js';

let server;

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

const startServer = () => {
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

    server = new grpc.Server();
    server.addService(itemsProto.ItemService.service, {
        getAll: createGetAllHandler(world),
    });

    server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), () => {
        log.info({ port }, 'GRPC server is listening');
    });
};

const stopServer = () => {
    server.forceShutdown();
};

export { createGetAllHandler, startServer, stopServer };
