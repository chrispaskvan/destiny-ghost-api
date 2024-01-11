import Agent, { HttpsAgent } from 'agentkeepalive';
import axios from 'axios';
import ResponseError from './response.error';
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
            instance ||= createInstance();

            return instance;
        },
    };
}());

/**
 * HTTP Request Client
 *
 * @param {*} options {@link https://axios-http.com/docs/req_config}
 * @returns {@link https://axios-http.com/docs/res_schema} | {@link https://axios-http.com/docs/handling_errors}
 */
async function request(options) {
    try {
        const axiosInstance = axiosSingleton.getInstance();
        const { data, headers } = await axiosInstance(options);

        return { data, headers };
    } catch (err) {
        if (err.response) {
            const responseError = new ResponseError(err);

            log.error({
                err: responseError,
            }, 'HTTP request failed!');

            throw responseError;
        }

        throw err;
    }
}

async function get(options, includeHeaders = false) {
    const { data, headers } = await request({
        method: 'get',
        ...options,
    });

    return includeHeaders ? { data, headers } : data;
}

async function post(options) {
    const { data } = await request({
        method: 'post',
        ...options,
    });

    return data;
}

export { get, post };
