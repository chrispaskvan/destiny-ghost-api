'use strict';
const bunyan = require('bunyan');

const defaults = {
    name: 'destiny-ghost-api',
    streams: [
        {
            level: 'info',
            path: './logs/destiny-ghost-api-request.log'
        },
        {
            level: 'error',
            path: './logs/destiny-ghost-api-error.log'
        }
    ]
};

class Log {
    constructor() {
        this.logger = bunyan.createLogger(defaults);
    }

    info(message, data) {
        this.logger.info({ message: data }, message);
    }

    error(err1) {
        this.logger.error({ err: err1});
    }
}

module.exports = new Log();
