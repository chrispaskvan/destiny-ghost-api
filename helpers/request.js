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
            if (!instance) {
                instance = createInstance();
            }

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
        const { data: responseBody } = await axiosInstance(options);

        return responseBody;
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
