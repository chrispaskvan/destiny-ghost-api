import { normalize, resolve } from 'path';

export default function sanitizeDirectory(directory) {
    const rootDirectory = process.env.INIT_CWD;
    const databaseDirectory = normalize(resolve(rootDirectory, directory));

    if (!databaseDirectory.startsWith(rootDirectory)) {
        throw new Error('Invalid database directory');
    }
}
