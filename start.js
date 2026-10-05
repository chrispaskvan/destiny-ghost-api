// First, so event-loop delay is measured across the rest of startup
import './helpers/event-loop-delay.js';
import gcPauses from './helpers/gc-pauses.js';
import { startServer } from './server.js';

function exitOnError(err) {
    console.error('Fatal error', err);
    process.exit(1);
}

async function start() {
    gcPauses.enable();
    await startServer({ grpc: true });
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
