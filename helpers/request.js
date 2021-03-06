const axios = require('axios');
const RequestError = require('./request.error');
const log = require('./log');

async function request(options) {
    try {
        const { data: responseBody } = await axios(options);

        return responseBody;
    } catch (err) {
        const requestError = new RequestError(err);

        log.error({
            message: 'HTTP request failed!',
            err,
            requestError,
        });

        throw requestError;
    }
}

module.exports = {
    get: async options => request({
        method: 'get',
        ...options,
    }),
    post: async options => request({
        method: 'post',
        ...options,
    }),
};
