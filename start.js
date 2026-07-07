import { startServer } from './server.js';
import { startServer as grpcStart } from './grpc.js';

function exitOnError(err) {
    console.error('Fatal error', err);
    process.exit(1);
}

async function start() {
    await startServer();
    await grpcStart();
}

process.on('unhandledRejection', reason => {
    // throw and let the uncaughtException handler handle it
    throw reason;
});

process.on('uncaughtException', err => {
    exitOnError(err);
});

start().catch(err => {
    exitOnError(err);
});
