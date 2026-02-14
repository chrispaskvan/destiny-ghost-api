import StreamArray from 'stream-json/streamers/StreamArray';
import nock from 'nock';
import { StatusCodes } from 'http-status-codes';
import { Readable } from 'node:stream';
import {
    afterAll, afterEach, beforeAll, describe, expect, test, vi,
} from 'vitest';
import { startServer, stopServer } from '../server';
import configuration from '../helpers/config';

vi.mock('../helpers/subscriber');

let baseUrl;
const ipAddress = '127.0.0.1';

beforeAll(async () => {
    process.env.PORT = 65535;

    const apiConnection = await startServer();

    baseUrl = `http://${ipAddress}:${apiConnection.port}`;

    // Ensure that this component is isolated by preventing unknown calls.
    nock.disableNetConnect();
    nock.enableNetConnect(ipAddress);
});

const get = async (url, options = {}) => {
    const delay = 1000; // milliseconds
    let res;
    let retries = options.retries ?? 5;
    const retryOn503 = options.retryOn503 ?? true;

    while (retries > 0) {
        const requestUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;

        res = await fetch(requestUrl, {
            method: 'GET',
            headers: options.headers,
            signal: options.signal,
        });

        if (res.status !== StatusCodes.SERVICE_UNAVAILABLE || !retryOn503) {
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
                const res = await get('/destiny2/inventory', {
                    headers: configuration.notificationHeaders,
                    retryOn503: false,
                });

                expect(res.status).toEqual(StatusCodes.SERVICE_UNAVAILABLE);
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
                            const page = await res.json();
    
                            yield page;
    
                            if (page.links.next) {
                                const { pathname, search } = new URL(page.links.next);
    
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
                    });
                    const stream = Readable.fromWeb(getResponse.body);
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

                    expect(getResponse.status).toEqual(StatusCodes.OK);
                    expect(items.length).toBeTruthy();
                    expect(items[0].displayProperties).toBeInstanceOf(Object);
                });

                test('should stop streaming the response when the request is aborted', async () => {
                    const controller = new AbortController();
                    const { signal } = controller;
                    const response = await fetch(`${baseUrl}/destiny2/inventory`, {
                        headers: configuration.notificationHeaders,
                        signal,
                    });

                    if (!response.body) {
                        throw new Error('Expected response body to be a stream');
                    }

                    const reader = response.body.getReader();
                    const readPromise = reader.read();

                    controller.abort();

                    await expect(readPromise).rejects.toMatchObject({ name: 'AbortError' });
                });
            });
        });
    });

    describe('GET /destiny2/xur', () => {
        describe('when requesting Xur\'s inventory of items', () => {
            test('should receive a response with an array of items', async () => {
                const getResponse = await get('/destiny2/xur');

                expect(getResponse.status).toEqual(StatusCodes.UNAUTHORIZED);
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
