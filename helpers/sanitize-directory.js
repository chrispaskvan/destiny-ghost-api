import { realpathSync } from 'node:fs';
import { normalize, resolve, sep } from 'node:path';

export default function sanitizeDirectory(directory) {
    if (directory.includes('\0')) {
        throw new Error('Invalid database directory');
    }

    const rootDirectory = realpathSync(process.env.INIT_CWD);
    const databaseDirectory = realpathSync(normalize(resolve(rootDirectory, directory)));

    if (!databaseDirectory.startsWith(rootDirectory + sep)) {
        throw new Error('Invalid database directory');
    }
}
