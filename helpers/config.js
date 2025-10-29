import { readFileSync, readdirSync } from 'fs';
import camelCase from 'lodash/camelCase.js';

function loadFile(file) {
    const data = readFileSync(`./settings/${file}`, 'utf8');

    return {
        [camelCase(file.split('.')[0])]: JSON.parse(data),
    };
}

const files = readdirSync('./settings');
const configurationFiles = files.filter(file => {
    const parts = file.split('.');
    // Keep files that are not environment-specific (e.g., 'name.json')
    if (parts.length === 2) {
        return true;
    }
    // Keep files that match the current environment (e.g., 'name.development.json')
    if (parts.length === 3) {
        return parts[1] === process.env.NODE_ENV;
    }
    return false;
});
const configurations = configurationFiles.map(file => loadFile(file));

export default Object.assign({}, ...configurations);
