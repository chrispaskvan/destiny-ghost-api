import { beforeEach, describe, expect, it, vi } from 'vitest';
import cache from './cache.js';
import { accept, release, reserve } from './idempotency-keys.js';

vi.mock('./cache.js', () => ({ default: { get: vi.fn(), set: vi.fn(), eval: vi.fn() } }));

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
});
