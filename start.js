import { startServer } from './server';

async function start() {
    await startServer();
}

start()
    .catch(err => {
        // eslint-disable-next-line no-console
        console.log(err);
        process.exit(1);
    });
