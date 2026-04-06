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
            const page = call.request.page || 1;
            const size = call.request.size || 11;
            const pages = Math.ceil(items.length / size);
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
