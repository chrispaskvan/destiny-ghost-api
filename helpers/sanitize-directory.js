import { realpathSync } from 'node:fs';
import { normalize, resolve, sep } from 'node:path';

export default function sanitizeDirectory(directory) {
    if (directory.includes('\0')) {
        throw new Error('Invalid database directory');
    }

    const initCwd = process.env.INIT_CWD || process.cwd();

    let rootDirectory;
    let databaseDirectory;

    try {
        rootDirectory = realpathSync(initCwd);
        databaseDirectory = realpathSync(normalize(resolve(rootDirectory, directory)));
    } catch {
        throw new Error('Invalid database directory');
    }

    if (!databaseDirectory.startsWith(rootDirectory + sep)) {
        throw new Error('Invalid database directory');
    }
}
