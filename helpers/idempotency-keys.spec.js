import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cache from './cache.js';
import log from './log.js';
import {
    accept,
    ACCEPT,
    keepAlive,
    operationIdFor,
    release,
    RELEASE,
    RENEW,
    reservationFor,
    reserve,
} from './idempotency-keys.js';
import { fakeRedis } from '../vitest.redis-lua.js';

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
    owner: 'owner-1',
};
const stored = (overrides = {}) =>
    JSON.stringify({
        operationId: 'op-0',
        fingerprint: reservation.fingerprint,
        state: 'accepted',
        ...overrides,
    });
const reservationKey = 'idempotency:notifications:x-api-key:xur-2026-10-09';

/**
 * Runs `cache.eval` on an in-memory Redis, so the real `ACCEPT`, `RENEW` and
 * `RELEASE` decide (#777).
 */
const useRedis = () => {
    const redis = fakeRedis();

    cache.eval.mockImplementation(redis.eval);

    return redis;
};

/**
 * Reserves through the real `reserve`, landing what it writes in `redis`,
 * with the expiry it asks for. Only for a free key: it doesn't play out
 * `NX`/`GET` (the `reserve` tests cover those against `cache.set`), so the
 * value the scripts compare against is the module's own, not a copy.
 * @param {ReturnType<typeof fakeRedis>} redis
 * @param {typeof reservation} [held]
 */
const reserveIn = async (redis, held = reservation) => {
    cache.set.mockImplementationOnce(async (key, value, { expiration }) => {
        redis.call('SET', key, value, 'EX', String(expiration.value));

        return null;
    });

    await expect(reserve(held)).resolves.toEqual({ outcome: 'reserved' });
};

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
            ['boundary between fields', { caller: 'x-api-keyx', key: 'ur-2026-10-09' }],
        ])('should name a different operation when the %s differs', (_label, change) => {
            expect(operationIdFor({ ...request, ...change })).not.toBe(operationIdFor(request));
        });

        /**
         * A key reused for a different request names the same operation, so
         * whoever records the work finds the earlier one and refuses the
         * reuse, instead of it becoming a second operation once the key's
         * reservation has lapsed.
         */
        it('should name the same operation for the same key, whatever the request asks for', () => {
            expect(
                operationIdFor({ ...request, fingerprint: 'POST /notifications/Banshee-44' }),
            ).toBe(operationIdFor(request));
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
            const input = `${request.caller}\n${request.key}`;
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

    describe('reservationFor', () => {
        const request = {
            caller: reservation.caller,
            key: reservation.key,
            fingerprint: reservation.fingerprint,
        };

        it('should name the operation the request stands for, with an owner of its own', () => {
            const first = reservationFor(request);
            const second = reservationFor(request);

            expect(first).toMatchObject({ ...request, operationId: operationIdFor(request) });
            expect(second.operationId).toBe(first.operationId);
            expect(first.owner).toEqual(expect.any(String));
            expect(second.owner).not.toBe(first.owner);
        });

        /**
         * The case the owner exists for: a request whose lease ran out, and
         * another that reserved the same request since. Both name the same
         * operation, so only the owner tells their reservations apart.
         */
        it.each([
            ['accept', accept],
            ['release', release],
        ])(
            "should not let one request %s another's reservation for the same operation",
            async (_name, act) => {
                const redis = useRedis();
                const stale = reservationFor(request);
                const current = reservationFor(request);

                await reserveIn(redis, current);

                await expect(act(stale)).resolves.toBe(false);
                await expect(act(current)).resolves.toBe(true);
            },
        );
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
                    owner: 'owner-1',
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
        ['accept', accept, ACCEPT],
        ['release', release, RELEASE],
    ])('%s', (_name, act, script) => {
        /** @type {ReturnType<typeof fakeRedis>} */
        let redis;

        beforeEach(() => {
            redis = useRedis();
        });

        it('should act only on our own pending reservation', async () => {
            await reserveIn(redis);
            const pending = redis.call('GET', reservationKey);

            await expect(act(reservation)).resolves.toBe(true);

            const [[called, { keys, arguments: args }]] = cache.eval.mock.calls;

            expect(called).toBe(script);
            expect(keys).toEqual([reservationKey]);
            expect(args[0]).toBe(pending);
        });

        it.each([
            ['lapsed', async () => {}],
            [
                'been reserved by another request since',
                () => reserveIn(redis, { ...reservation, owner: 'owner-2' }),
            ],
            [
                'already been accepted',
                async () => {
                    await reserveIn(redis);
                    await accept(reservation);
                },
            ],
        ])('should leave a reservation that has %s alone', async (_case, arrange) => {
            await arrange();
            const before = redis.call('GET', reservationKey);

            await expect(act(reservation)).resolves.toBe(false);
            expect(redis.call('GET', reservationKey)).toBe(before);
        });
    });

    describe('accept', () => {
        it('should keep the accepted operation for a day', async () => {
            const redis = useRedis();

            await reserveIn(redis);
            await accept(reservation);

            expect(JSON.parse(String(redis.call('GET', reservationKey)))).toEqual({
                operationId: 'op-1',
                fingerprint: reservation.fingerprint,
                state: 'accepted',
                owner: 'owner-1',
            });
            expect(redis.ttl(reservationKey)).toBe(86_400);
        });
    });

    describe('release', () => {
        it('should free the key for a retry', async () => {
            const redis = useRedis();

            await reserveIn(redis);
            await release(reservation);

            expect(redis.call('GET', reservationKey)).toBeNull();
        });
    });

    describe('keepAlive', () => {
        /** @type {ReturnType<typeof fakeRedis>} */
        let redis;
        /** What `reserve` stored, which each renewal must match. */
        let pending;

        /**
         * The real lease, on the fake clock: `reserve` takes the key for 60
         * seconds, and it lapses unless a renewal lands first.
         */
        beforeEach(async () => {
            vi.useFakeTimers();
            redis = useRedis();
            await reserveIn(redis);
            pending = redis.call('GET', reservationKey);
        });

        afterEach(() => {
            // A renewal that was never stopped must not outlive its test.
            vi.clearAllTimers();
            vi.useRealTimers();
        });

        it('should renew our own lease every 20 seconds until stopped', async () => {
            const stop = keepAlive(reservation);

            await vi.advanceTimersByTimeAsync(19_999);
            expect(cache.eval).not.toHaveBeenCalled();
            expect(redis.ttl(reservationKey)).toBe(40);

            await vi.advanceTimersByTimeAsync(1);
            expect(cache.eval).toHaveBeenCalledOnce();
            expect(redis.ttl(reservationKey)).toBe(60);

            const [[script, { keys, arguments: args }]] = cache.eval.mock.calls;

            expect(script).toBe(RENEW);
            expect(keys).toEqual([reservationKey]);
            expect(args).toEqual([pending, '60']);

            await vi.advanceTimersByTimeAsync(40_000);
            expect(cache.eval).toHaveBeenCalledTimes(3);

            stop();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(cache.eval).toHaveBeenCalledTimes(3);
        });

        it('should hold the key past its first lease for as long as it renews', async () => {
            const stop = keepAlive(reservation);

            await vi.advanceTimersByTimeAsync(5 * 60_000);
            expect(redis.call('GET', reservationKey)).toBe(pending);

            stop();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(redis.call('GET', reservationKey)).toBeNull();
        });

        it('should stop renewing once the reservation is no longer ours', async () => {
            redis.call('DEL', reservationKey);
            await reserveIn(redis, { ...reservation, owner: 'owner-2' });

            keepAlive(reservation);
            await vi.advanceTimersByTimeAsync(60_000);

            expect(cache.eval).toHaveBeenCalledOnce();
            expect(log.warn).toHaveBeenCalledOnce();
        });

        it('should keep renewing after a renewal fails', async () => {
            cache.eval.mockRejectedValueOnce(new Error('Redis unavailable'));

            const stop = keepAlive(reservation);

            await vi.advanceTimersByTimeAsync(40_000);

            expect(cache.eval).toHaveBeenCalledTimes(2);
            expect(log.warn).toHaveBeenCalledOnce();
            // The second renewal landed inside the first lease, and reset it.
            expect(redis.ttl(reservationKey)).toBe(60);
            stop();
        });
    });
});
