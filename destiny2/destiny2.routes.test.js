import axios from 'axios';
import nock from 'nock';
import {
    afterAll, afterEach, beforeAll, describe, expect, test, vi,
} from 'vitest';
import { startServer, stopServer } from '../server';

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
        describe('when requesting the inventory of items', () => {
            test('should receive a response with an array of items', async () => {
                const getResponse = await axiosAPIClient.get('/destiny2/inventory');

                expect(getResponse).toMatchObject({
                    status: 200,
                });
                expect(getResponse.data.length).toBeGreaterThan(1);
            });
        });
    });

    describe('GET /destiny2/xur', () => {
        describe('when requesting Xur\'s inventory of items', () => {
            test('should receive a response with an array of items', async () => {
                const getResponse = await axiosAPIClient.get('/destiny2/xur');

                expect(getResponse).toMatchObject({
                    status: 401,
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
