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

    // ️️️Ensure that this component is isolated by preventing unknown calls.
    nock.disableNetConnect();
    nock.enableNetConnect(ipAddress);
});

describe('/destiny2', () => {
    describe('GET /destiny2/inventory', () => {
        /**
         * The intent of this test is to use async iterators to load a complete set of results by
         * fetching page after page.
         */
        describe('when requesting the inventory of items with pagination', () => {
            test('should receive a response with an array of items, HATEOAS links, and pagination statistics', async () => {
                const items = [];
                const limit = 15;

                async function* pageThrough(url) {
                    async function* get(_url) {
                        const res = await axiosAPIClient.get(_url, {
                            headers: configuration.notificationHeaders,
                        });
                        const page = res.data;

                        yield page;

                        if (res.data.links.next) {
                            const { pathname, search } = new URL(res.data.links.next);

                            yield* get(`${pathname}${search}`);
                        }
                    }

                    yield* get(url);
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
                const getResponse = await axiosAPIClient.get('/destiny2/inventory', {
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
