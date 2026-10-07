import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cache from './cache.js';
import log from './log.js';
import { accept, keepAlive, operationIdFor, release, reserve } from './idempotency-keys.js';

vi.mock('./cache.js', () => ({ default: { get: vi.fn(), set: vi.fn(), eval: vi.fn() } }));
vi.mock('./log.js', () => ({ default: { warn: vi.fn() } }));
vi.mock('./config.js', () => ({ default: { session: { secret: 'test-session-secret' } } }));

/**
 * Just enough of Redis's GET and SET for two requests to interleave: every
 * command resolves on a later turn, as a network round trip would, and SET
 * honours NX and GET in one step, as the server does.
 */
const inMemoryCache = () => {
    const store = new Map();
    const later = value => new Promise(resolve => setImmediate(() => resolve(value)));

    cache.get.mockImplementation(key => later(store.get(key) ?? null));
    cache.set.mockImplementation((key, value, { condition, GET } = {}) => {
        const previous = store.get(key) ?? null;

        if (!(condition === 'NX' && previous !== null)) {
            store.set(key, value);
        }

        return later(GET ? previous : 'OK');
    });
};

const reservation = {
    caller: 'x-api-key',
    key: 'xur-2026-10-09',
    fingerprint: 'POST /notifications/Xur',
    operationId: 'op-1',
};
const stored = (overrides = {}) =>
    JSON.stringify({
        operationId: 'op-0',
        fingerprint: reservation.fingerprint,
        state: 'accepted',
        ...overrides,
    });

describe('idempotency-keys', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('operationIdFor', () => {
        const request = {
            caller: reservation.caller,
            key: reservation.key,
            fingerprint: reservation.fingerprint,
        };

        it('should name the same operation every time for the same request', () => {
            expect(operationIdFor(request)).toBe(operationIdFor({ ...request }));
        });

        it.each([
            ['caller', { caller: 'notification-headers' }],
            ['key', { key: 'xur-2026-10-16' }],
            ['fingerprint', { fingerprint: 'POST /notifications/Banshee-44' }],
            ['boundary between fields', { caller: 'x-api-keyx', key: 'ur-2026-10-09' }],
        ])('should name a different operation when the %s differs', (_label, change) => {
            expect(operationIdFor({ ...request, ...change })).not.toBe(operationIdFor(request));
        });

        it('should make an id BullMQ accepts as a job id', () => {
            expect(operationIdFor(request)).toMatch(/^[0-9a-f]{64}$/);
        });

        /**
         * The id is the claim check that progress and receipts are read
         * with, so knowing the caller, route and key must not be enough to
         * work it out: it is an HMAC under a subkey of the session secret,
         * not a plain hash and not keyed with the session secret itself.
         */
        it('should be keyed with a subkey of the server secret, not computable from the request alone', () => {
            const input = `${request.caller}\n${request.key}\n${request.fingerprint}`;
            const subkey = Buffer.from(
                hkdfSync('sha256', 'test-session-secret', '', 'idempotency-operation-id', 32),
            );

            expect(operationIdFor(request)).toBe(
                createHmac('sha256', subkey).update(input).digest('hex'),
            );
            expect(operationIdFor(request)).not.toBe(
                createHash('sha256').update(input).digest('hex'),
            );
            expect(operationIdFor(request)).not.toBe(
                createHmac('sha256', 'test-session-secret').update(input).digest('hex'),
            );
        });

        it('should key with the first session secret when there is a list of them', async () => {
            vi.resetModules();
            vi.doMock('./config.js', () => ({
                default: { session: { secret: ['test-session-secret', 'older-secret'] } },
            }));

            const { operationIdFor: withList } = await import('./idempotency-keys.js');

            expect(withList(request)).toBe(operationIdFor(request));
            vi.doUnmock('./config.js');
        });
    });

    describe('reserve', () => {
        it('should reserve in one atomic command, namespaced and scoped to the caller', async () => {
            cache.set.mockResolvedValue(null);

            await expect(reserve(reservation)).resolves.toEqual({ outcome: 'reserved' });

            expect(cache.set).toHaveBeenCalledExactlyOnceWith(
                'idempotency:notifications:x-api-key:xur-2026-10-09',
                JSON.stringify({
                    operationId: 'op-1',
                    fingerprint: reservation.fingerprint,
                    state: 'pending',
                }),
                { condition: 'NX', expiration: { type: 'EX', value: 60 }, GET: true },
            );
        });

        it('should let exactly one of two concurrent requests reserve a key', async () => {
            inMemoryCache();

            const results = await Promise.all([
                reserve(reservation),
                reserve({ ...reservation, operationId: 'op-2' }),
            ]);

            expect(results.map(({ outcome }) => outcome).sort()).toEqual([
                'in-progress',
                'reserved',
            ]);
        });

        it('should keep two callers using the same key apart', async () => {
            cache.set.mockResolvedValue(null);

            await reserve(reservation);
            await reserve({ ...reservation, caller: 'notification-headers' });

            const [[first], [second]] = cache.set.mock.calls;

            expect(first).not.toBe(second);
        });

        it('should replay the operation an accepted key holds', async () => {
            cache.set.mockResolvedValue(stored());

            await expect(reserve(reservation)).resolves.toEqual({
                outcome: 'replay',
                operationId: 'op-0',
            });
        });

        it('should report a key another request is still starting', async () => {
            cache.set.mockResolvedValue(stored({ state: 'pending' }));

            await expect(reserve(reservation)).resolves.toEqual({ outcome: 'in-progress' });
        });

        it.each(['accepted', 'pending'])(
            'should refuse a key reused for a different request, %s or not',
            async state => {
                cache.set.mockResolvedValue(
                    stored({ fingerprint: 'POST /notifications/Banshee-44', state }),
                );

                await expect(reserve(reservation)).resolves.toEqual({ outcome: 'mismatch' });
            },
        );
    });

    describe.each([
        ['accept', accept],
        ['release', release],
    ])('%s', (_name, act) => {
        it('should act only on our own pending reservation', async () => {
            cache.eval.mockResolvedValue(1);

            await expect(act(reservation)).resolves.toBe(true);

            const [, { keys, arguments: args }] = cache.eval.mock.calls[0];

            expect(keys).toEqual(['idempotency:notifications:x-api-key:xur-2026-10-09']);
            expect(args[0]).toBe(
                JSON.stringify({
                    operationId: 'op-1',
                    fingerprint: reservation.fingerprint,
                    state: 'pending',
                }),
            );
        });

        it('should report a reservation that is no longer ours', async () => {
            cache.eval.mockResolvedValue(0);

            await expect(act(reservation)).resolves.toBe(false);
        });
    });

    describe('accept', () => {
        it('should keep the accepted operation for a day', async () => {
            cache.eval.mockResolvedValue(1);

            await accept(reservation);

            const [, { arguments: args }] = cache.eval.mock.calls[0];

            expect(JSON.parse(args[1])).toEqual({
                operationId: 'op-1',
                fingerprint: reservation.fingerprint,
                state: 'accepted',
            });
            expect(args[2]).toBe('86400');
        });
    });

    describe('keepAlive', () => {
        const pending = JSON.stringify({
            operationId: 'op-1',
            fingerprint: reservation.fingerprint,
            state: 'pending',
        });

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            // A renewal that was never stopped must not outlive its test.
            vi.clearAllTimers();
            vi.useRealTimers();
        });

        it('should renew our own lease every 20 seconds until stopped', async () => {
            cache.eval.mockResolvedValue(1);

            const stop = keepAlive(reservation);

            await vi.advanceTimersByTimeAsync(19_999);
            expect(cache.eval).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(40_001);
            expect(cache.eval).toHaveBeenCalledTimes(3);

            const [, { keys, arguments: args }] = cache.eval.mock.calls[0];

            expect(keys).toEqual(['idempotency:notifications:x-api-key:xur-2026-10-09']);
            expect(args).toEqual([pending, '60']);

            stop();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(cache.eval).toHaveBeenCalledTimes(3);
        });

        it('should stop renewing once the reservation is no longer ours', async () => {
            cache.eval.mockResolvedValue(0);

            keepAlive(reservation);
            await vi.advanceTimersByTimeAsync(60_000);

            expect(cache.eval).toHaveBeenCalledOnce();
            expect(log.warn).toHaveBeenCalledOnce();
        });

        it('should keep renewing after a renewal fails', async () => {
            cache.eval.mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(1);

            const stop = keepAlive(reservation);

            await vi.advanceTimersByTimeAsync(40_000);

            expect(cache.eval).toHaveBeenCalledTimes(2);
            expect(log.warn).toHaveBeenCalledOnce();
            stop();
        });
    });
});
