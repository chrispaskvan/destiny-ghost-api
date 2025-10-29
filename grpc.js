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
            Object.entries(configuration.notificationHeaders).forEach(entry => {
                const [key, value1] = entry;
                const [value2] = call.metadata.get(key);

                if (value1 !== value2) {
                    callback({
                        code: grpc.status.UNAUTHENTICATED,
                    });
                }
            });

            callback(null, { items: world.items });
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
