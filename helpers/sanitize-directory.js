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

    const rootWithSep = rootDirectory.endsWith(sep) ? rootDirectory : rootDirectory + sep;

    if (!databaseDirectory.startsWith(rootWithSep)) {
        throw new Error('Invalid database directory');
    }
}
