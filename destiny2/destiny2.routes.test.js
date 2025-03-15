import StreamArray from 'stream-json/streamers/StreamArray';
import axios from 'axios';
import nock from 'nock';
import { StatusCodes } from 'http-status-codes';
import {
    afterAll, afterEach, beforeAll, describe, expect, test, vi,
} from 'vitest';
import { startServer, stopServer } from '../server';
import configuration from '../helpers/config';

vi.mock('../helpers/subscriber');

let axiosAPIClient;
const ipAddress = '127.0.0.1';

beforeAll(async () => {
    process.env.PORT = 65535;

    const apiConnection = await startServer();
    const axiosConfig = {
        baseURL: `http://${ipAddress}:${apiConnection.port}`,
        // Do not throw HTTP exceptions. Delegate to the tests to decide which error is acceptable.
        validateStatus: () => true,
    };

    axiosAPIClient = axios.create(axiosConfig);

    // Ensure that this component is isolated by preventing unknown calls.
    nock.disableNetConnect();
    nock.enableNetConnect(ipAddress);
});

const get = async (url, options) => {
    const delay = 1000; // milliseconds
    let res;
    let retries = 3;

    while (retries > 0) {
        res = await axiosAPIClient.get(url, options);

        if (res.status !== StatusCodes.SERVICE_UNAVAILABLE) {
            break;
        }

        retries -= 1;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    return res;
};

describe('/destiny2', () => {
    describe('GET /destiny2/inventory', () => {
        describe('when the server is not ready', async () => {
            test('should receive a response with a 503 status code', async () => {
                const res = await axiosAPIClient.get('/destiny2/inventory', {
                    headers: configuration.notificationHeaders,
                });

                expect(res).toMatchObject({
                    status: StatusCodes.SERVICE_UNAVAILABLE,
                });
            });
        });

        describe('when the server is ready', async () => {
            /**
             * The intent of this test is to use async iterators to load a complete set of results by
             * fetching page after page.
             */
            describe('when requesting the inventory of items with pagination', () => {
                test('should receive a response with an array of items, HATEOAS links, and pagination statistics', async () => {
                    const items = [];
                    const limit = 15;
    
                    async function* pageThrough(url) {
                        async function* fetchPage(_url) {
                            const res = await get(_url, {
                                headers: configuration.notificationHeaders,
                            });
                            const page = res.data;
    
                            yield page;
    
                            if (res.data.links.next) {
                                const { pathname, search } = new URL(res.data.links.next);
    
                                yield* fetchPage(`${pathname}${search}`, {
                                    headers: configuration.notificationHeaders,
                                });
                            }
                        }
    
                        yield* fetchPage(url, {
                            headers: configuration.notificationHeaders,
                        });
                    }
    
                    async function* loadItems(url) {
                        const result = pageThrough(url);
    
                        for await (const page of result) {
                            for (const item of page.data) {
                                yield item;
                            }
                        }
                    }
    
                    for await (const item of loadItems('/destiny2/inventory?page=1&size=11')) {
                        items.push(item);
                        if (items.length >= limit) {
                            break;
                        }
                    }
    
                    expect(items.length).toEqual(limit);
                });
            });

            /**
             * The intent of this test is to successfully parse objects from an array delivered by a
             * JSON stream. The test deliberately exits before processing the entire stream in order to
             * finish before the default 5 second timeout.
             */
            describe('when requesting the inventory of items without pagination', () => {
                test('should receive a response with an array of items', async () => {
                    const getResponse = await get('/destiny2/inventory', {
                        headers: configuration.notificationHeaders,
                        responseType: 'stream',
                    });
                    const stream = getResponse.data;
                    const objectsStream = stream.pipe(StreamArray.withParser());
                    const items = [];

                    await new Promise((resolve, reject) => {
                        objectsStream.on('data', data => {
                            items.push(data.value);

                            if (items.length > 1) resolve();
                        });
                        objectsStream.on('end', () => {
                            resolve();
                        });
                        objectsStream.on('error', err => {
                            reject(err);
                        });
                    });

                    expect(getResponse).toMatchObject({
                        status: StatusCodes.OK,
                    });
                    expect(items.length).toBeTruthy();
                    expect(items[0].displayProperties).toBeInstanceOf(Object);
                });

                test('should stop streaming the response when the request is aborted', async () => {
                    const controller = new AbortController();
                    const { signal } = controller;

                    setTimeout(() => controller.abort(), 500);

                    try {
                        await get(`http://${ipAddress}:${process.env.PORT}/destiny2/inventory`, {
                            headers: configuration.notificationHeaders,
                            signal,
                        });
                        
                        throw new Error('Request should have been aborted');
                    } catch (err) {
                        expect(err.name).toEqual('CanceledError');
                    }
                });
            });
        });
    });

    describe('GET /destiny2/xur', () => {
        describe('when requesting Xur\'s inventory of items', () => {
            test('should receive a response with an array of items', async () => {
                const getResponse = await axiosAPIClient.get('/destiny2/xur');

                expect(getResponse).toMatchObject({
                    status: StatusCodes.UNAUTHORIZED,
                });
            });
        });
    });
});

afterEach(() => {
    nock.cleanAll();
});

/**
 * Clean up resources after each run.
 */
afterAll(async () => {
    await stopServer();
    nock.enableNetConnect();
});
