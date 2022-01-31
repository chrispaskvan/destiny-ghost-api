const Agent = require('agentkeepalive');
const axios = require('axios');
const RequestError = require('./request.error');
const log = require('./log');

const axiosSingleton = (function singleton() {
    let instance;

    function createInstance() {
        const httpAgent = new Agent();
        const httpsAgent = new Agent.HttpsAgent();
        const axiosInstance = axios.create({
            httpAgent,
            httpsAgent,
        });

        return axiosInstance;
    }

    return {
        getInstance() {
            if (!instance) {
                instance = createInstance();
            }

            return instance;
        },
    };
}());

async function request(options) {
    try {
        const axiosInstance = axiosSingleton.getInstance();
        const { data: responseBody } = await axiosInstance(options);

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
