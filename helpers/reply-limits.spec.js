import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repliesConsume, iconsConsume, scansConsume, scansReward, limiterOptions, MockRes } =
    vi.hoisted(() => ({
        // Recorded at import time; `clearMocks` would wipe the calls of a vi.fn() constructor.
        limiterOptions: [],
        repliesConsume: vi.fn(),
        iconsConsume: vi.fn(),
        scansConsume: vi.fn(),
        scansReward: vi.fn(),
        MockRes: class RateLimiterRes {
            constructor(consumedPoints = 0) {
                this.consumedPoints = consumedPoints;
            }
        },
    }));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        constructor(options) {
            limiterOptions.push(options);
            this.consume = {
                'reply-day': repliesConsume,
                'reply-icons': iconsConsume,
                'mms-scans': scansConsume,
            }[options.keyPrefix];
            this.reward = scansReward;
        }
    },
    RateLimiterRes: MockRes,
}));
vi.mock('./cache.js', () => ({
    default: { isReady: true },
}));
vi.mock('./log.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import cache from './cache.js';
import log from './log.js';
import replyLimits, { ICONS_PER_DAY, REPLIES_PER_DAY, SCANS_PER_DAY } from './reply-limits.js';

const from = '+12085550123';

beforeEach(() => {
    cache.isReady = true;
    repliesConsume.mockResolvedValue({});
    iconsConsume.mockResolvedValue({});
    scansConsume.mockResolvedValue({});
    scansReward.mockResolvedValue({});
});

describe('reply limits', () => {
    it('keeps a day-long bucket for each on the cache client', () => {
        expect(limiterOptions).toEqual(
            [
                ['reply-day', REPLIES_PER_DAY],
                ['reply-icons', ICONS_PER_DAY],
                ['mms-scans', SCANS_PER_DAY],
            ].map(([keyPrefix, points]) =>
                expect.objectContaining({
                    keyPrefix,
                    points,
                    duration: 86_400,
                    storeClient: cache,
                    useRedisPackage: true,
                }),
            ),
        );
    });

    it('allows 100 replies, 25 icons and 10 scans a day', () => {
        expect([REPLIES_PER_DAY, ICONS_PER_DAY, SCANS_PER_DAY]).toEqual([100, 25, 10]);
    });

    describe('answer', () => {
        it('replies within the day, charging the sender', async () => {
            await expect(replyLimits.answer(from)).resolves.toBe('reply');

            expect(repliesConsume).toHaveBeenCalledWith(from);
        });

        it('sends the notice for the first text over the limit only', async () => {
            repliesConsume.mockRejectedValueOnce(new MockRes(REPLIES_PER_DAY + 1));
            repliesConsume.mockRejectedValueOnce(new MockRes(REPLIES_PER_DAY + 2));

            await expect(replyLimits.answer(from)).resolves.toBe('notice');
            await expect(replyLimits.answer(from)).resolves.toBe('quiet');
            expect(log.warn).toHaveBeenCalledOnce();
        });

        it.each([
            ['not ready', () => (cache.isReady = false)],
            ['rejecting commands', () => repliesConsume.mockRejectedValue(new Error('READONLY'))],
        ])('fails open while Redis is %s', async (_, breakRedis) => {
            breakRedis();

            await expect(replyLimits.answer(from)).resolves.toBe('reply');
        });
    });

    describe('allowIcon', () => {
        it('allows an icon within the day', async () => {
            await expect(replyLimits.allowIcon(from)).resolves.toBe(true);

            expect(iconsConsume).toHaveBeenCalledWith(from);
        });

        it("drops the icon once the day's are spent", async () => {
            iconsConsume.mockRejectedValue(new MockRes(ICONS_PER_DAY + 1));

            await expect(replyLimits.allowIcon(from)).resolves.toBe(false);
        });

        it.each([
            ['not ready', () => (cache.isReady = false)],
            ['rejecting commands', () => iconsConsume.mockRejectedValue(new Error('READONLY'))],
        ])('fails toward plain SMS while Redis is %s', async (_, breakRedis) => {
            breakRedis();

            await expect(replyLimits.allowIcon(from)).resolves.toBe(false);
        });
    });

    describe('allowScans', () => {
        it('allows every image within the day, one point each', async () => {
            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(3);

            expect(scansConsume).toHaveBeenCalledTimes(3);
        });

        it('allows only what is left of the day', async () => {
            scansConsume
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new MockRes(SCANS_PER_DAY + 1));

            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(1);

            /** Stops at the first refusal rather than charging the rest. */
            expect(scansConsume).toHaveBeenCalledTimes(2);
        });

        it('keeps what was allowed before Redis failed', async () => {
            scansConsume.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('READONLY'));

            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(1);
            expect(log.error).toHaveBeenCalled();
        });

        it('fails closed when Redis is not ready', async () => {
            cache.isReady = false;

            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(0);
            expect(scansConsume).not.toHaveBeenCalled();
        });
    });

    describe('refundScans', () => {
        it('gives the points back', async () => {
            await replyLimits.refundScans(from, 2);

            expect(scansReward).toHaveBeenCalledWith(from, 2);
        });

        it('only logs a failed refund', async () => {
            const err = new Error('READONLY');

            scansReward.mockRejectedValue(err);

            await expect(replyLimits.refundScans(from, 2)).resolves.toBeUndefined();
            expect(log.warn).toHaveBeenCalledWith({ err, from }, expect.any(String));
        });
    });
});
