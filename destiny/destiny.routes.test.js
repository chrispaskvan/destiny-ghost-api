import nock from 'nock';
import { StatusCodes } from 'http-status-codes';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { startServer, stopServer } from '../server.js';

vi.mock('../helpers/subscriber.js');

let baseUrl;
const ipAddress = '127.0.0.1';

beforeAll(async () => {
    process.env.PORT = 65534;

    /**
     * Refuse every outbound HTTP request but loopback, before the server
     * starts, so startup is fenced too (#784). That includes the Bungie
     * manifest-version checks `startServer()` fires: they are refused and
     * logged as failed, and the grimoire cards come from the Destiny manifest
     * database already on disk - run the dev server once to download it.
     * Redis is the one real service this test reaches.
     */
    nock.disableNetConnect();
    nock.enableNetConnect(ipAddress);

    const apiConnection = await startServer();

    baseUrl = `http://${ipAddress}:${apiConnection.port}`;
});

describe('/destiny', () => {
    describe('GET /destiny/grimoireCards/{numberOfCards}', () => {
        describe('when requesting X number of grimoire cards', () => {
            test('should receive a response with X number of grimoire cards', async () => {
                const numberOfCards = 2;
                const requestId = 'Incandescent';

                const response = await fetch(`${baseUrl}/destiny/grimoireCards/${numberOfCards}`, {
                    method: 'GET',
                    headers: {
                        'X-Request-Id': requestId,
                    },
                });
                const data = await response.json();

                expect(response.status).toEqual(StatusCodes.OK);
                expect(data.length).toEqual(numberOfCards);
                expect(response.headers.get('x-request-id')).toEqual(requestId);
                expect(response.headers.get('x-trace-id')).toBeTruthy();
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
