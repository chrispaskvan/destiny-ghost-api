import { startServer } from './server';

function exitOnError(err) {
    // eslint-disable-next-line no-console
    console.log(err);
    process.exit(1);
}

async function start() {
    await startServer();
}

process.on('unhandledRejection', reason => {
    // throw and let the uncaughtException handler handle it
    throw reason;
});

process.on('uncaughtException', err => {
    exitOnError(err);
});

start()
    .catch(err => {
        exitOnError(err);
    });
