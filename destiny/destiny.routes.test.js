import axios from 'axios';
import nock from 'nock';
import { StatusCodes } from 'http-status-codes';
import {
    afterAll, afterEach, beforeAll, describe, expect, test, vi,
} from 'vitest';
import { startServer, stopServer } from '../server';

vi.mock('../helpers/subscriber');

let axiosAPIClient;
const ipAddress = '127.0.0.1';

beforeAll(async () => {
    process.env.PORT = 65534;

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

describe('/destiny', () => {
    describe('GET /destiny/grimoireCards/{numberOfCards}', () => {
        describe('when requesting X number of grimoire cards', () => {
            test('should receive a response with X number of grimoire cards', async () => {
                const numberOfCards = 2;
                const requestId = 'Incandescent';

                const getResponse = await axiosAPIClient({
                    method: 'get',
                    url: `/destiny/grimoireCards/${numberOfCards}`,
                    headers: {
                        'X-Request-Id': requestId,
                    },
                });

                expect(getResponse).toMatchObject({
                    status: StatusCodes.OK,
                });
                expect(getResponse.data.length).toEqual(numberOfCards);
                expect(getResponse.headers['x-request-id']).toEqual(requestId);
                expect(getResponse.headers['x-request-id']).toBeDefined();
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
