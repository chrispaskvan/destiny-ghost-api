import { readFileSync, readdirSync } from 'fs';
import camelCase from 'lodash/camelCase';

function loadFile(file) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const data = readFileSync(`./settings/${file}`, 'utf8');

    return {
        [camelCase(file.split('.')[0])]: JSON.parse(data),
    };
}

const files = readdirSync('./settings');
const configurationFiles = files.filter(file => {
    if (file.split('.').length > 2) {
        return file.includes(process.env.NODE_ENV);
    }

    return true;
});
const configurations = configurationFiles.map(file => loadFile(file));

export default Object.assign({}, ...configurations);
