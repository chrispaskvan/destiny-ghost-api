import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import configuration from './helpers/config.js';
import World2 from './helpers/world2.js';
import pool from './helpers/pool.js';

let server;

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
        getAll: (call, callback) => {
            for (const [key, value1] of Object.entries(configuration.notificationHeaders)) {
                const [value2] = call.metadata.get(key);

                if (value1 !== value2) {
                    return callback({ code: grpc.status.UNAUTHENTICATED });
                }
            }

            const items = world.items;

            if (!items?.length) {
                return callback({ code: grpc.status.UNAVAILABLE });
            }

            const page = call.request.page || 1;
            const size = call.request.size || 11;
            const MAX_SIZE = 100;

            if (page < 1 || size < 1 || size > MAX_SIZE) {
                return callback({ code: grpc.status.INVALID_ARGUMENT });
            }

            const pages = Math.ceil(items.length / size);

            if (page > pages) {
                return callback({ code: grpc.status.OUT_OF_RANGE });
            }

            const data = items.slice((page - 1) * size, page * size);

            callback(null, {
                data,
                links: {
                    next: page < pages ? String(page + 1) : '',
                },
                page: {
                    size,
                    total: items.length,
                    pages,
                    number: page,
                },
            });
        },
    });

    server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), () => {
        console.log(`GRPC server listening on port ${port}.`);
    });
};

const stopServer = () => {
    server.forceShutdown();
};

export {
    startServer,
    stopServer,
};
