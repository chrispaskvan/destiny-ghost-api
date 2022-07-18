import Agent, { HttpsAgent } from 'agentkeepalive';
import axios from 'axios';
import RequestError from './request.error';
import log from './log';

const axiosSingleton = (function singleton() {
    let instance;

    function createInstance() {
        const httpAgent = new Agent();
        const httpsAgent = new HttpsAgent();
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

async function get(options) {
    return request({
        method: 'get',
        ...options,
    });
}

async function post(options) {
    return request({
        method: 'post',
        ...options,
    });
}

export { get, post };
