const { camelCase } = require('lodash');
const fs = require('fs');

function loadFile(file) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const data = fs.readFileSync(`./settings/${file}`, 'utf8');

    return {
        [camelCase(file.split('.')[0])]: JSON.parse(data),
    };
}

const files = fs.readdirSync('./settings');
const configurationFiles = files.filter(file => {
    if (file.split('.').length > 2) {
        return file.includes(process.env.NODE_ENV);
    }

    return true;
});
const configurations = configurationFiles.map(file => loadFile(file));

module.exports = Object.assign({}, ...configurations);
