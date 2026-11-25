import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repliesConsume, iconsConsume, limiterOptions, MockRes } = vi.hoisted(() => ({
    // Recorded at import time; `clearMocks` would wipe the calls of a vi.fn() constructor.
    limiterOptions: [],
    repliesConsume: vi.fn(),
    iconsConsume: vi.fn(),
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
            }[options.keyPrefix];
        }
    },
    RateLimiterRes: MockRes,
}));
vi.mock('./cache.js', () => ({
    /** Scans are counted by script; the scripts' own runs are against Redis. */
    default: { isReady: true, eval: vi.fn() },
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
    cache.eval.mockReset().mockResolvedValue(0);
});

describe('reply limits', () => {
    it('keeps a day-long bucket for replies and icons on the cache client', () => {
        expect(limiterOptions).toEqual(
            [
                ['reply-day', REPLIES_PER_DAY],
                ['reply-icons', ICONS_PER_DAY],
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

    describe('chargeText', () => {
        it('replies within the day, charging the sender', async () => {
            await expect(replyLimits.chargeText(from)).resolves.toBe('reply');

            expect(repliesConsume).toHaveBeenCalledWith(from);
        });

        it('sends the notice for the first text over the limit only', async () => {
            repliesConsume.mockRejectedValueOnce(new MockRes(REPLIES_PER_DAY + 1));
            repliesConsume.mockRejectedValueOnce(new MockRes(REPLIES_PER_DAY + 2));

            await expect(replyLimits.chargeText(from)).resolves.toBe('notice');
            await expect(replyLimits.chargeText(from)).resolves.toBe('quiet');
            expect(log.warn).toHaveBeenCalledOnce();
        });

        it.each([
            ['not ready', () => (cache.isReady = false)],
            ['rejecting commands', () => repliesConsume.mockRejectedValue(new Error('READONLY'))],
        ])('fails open while Redis is %s', async (_, breakRedis) => {
            breakRedis();

            await expect(replyLimits.chargeText(from)).resolves.toBe('reply');
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
        const reserve = () => cache.eval.mock.calls[0];

        it("reserves the images in one script call against the number's counter", async () => {
            cache.eval.mockResolvedValue(3);

            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(3);

            const [script, { keys, arguments: args }] = reserve();

            expect(cache.eval).toHaveBeenCalledOnce();
            expect(script).toContain('INCRBY');
            expect(keys).toEqual([`mms-scans:${from}`]);
            expect(args).toEqual(['3', String(SCANS_PER_DAY), '86400']);
        });

        /**
         * The script adds only what it grants, so a partial grant leaves the
         * counter at the limit, not past it; this only checks what it is asked.
         */
        it('allows only what is left of the day', async () => {
            cache.eval.mockResolvedValue(1);

            await expect(replyLimits.allowScans(from, 3)).resolves.toBe(1);
            expect(log.info).toHaveBeenCalledWith(
                { from, allowed: 1, wanted: 3, limit: SCANS_PER_DAY },
                expect.any(String),
            );
        });

        it('allows nothing once the day is spent', async () => {
            await expect(replyLimits.allowScans(from, 2)).resolves.toBe(0);
        });

        /** Null, not 0: an unanswered check isn't a spent day. */
        it('fails closed when Redis rejects the script', async () => {
            const err = new Error('READONLY');

            cache.eval.mockRejectedValue(err);

            await expect(replyLimits.allowScans(from, 3)).resolves.toBeNull();
            expect(log.error).toHaveBeenCalledWith({ err, from }, expect.any(String));
        });

        it('fails closed when Redis is not ready', async () => {
            cache.isReady = false;

            await expect(replyLimits.allowScans(from, 3)).resolves.toBeNull();
            expect(cache.eval).not.toHaveBeenCalled();
        });
    });

    describe('refundScans', () => {
        it("gives the scans back to the number's counter by script", async () => {
            await replyLimits.refundScans(from, 2);

            const [script, { keys, arguments: args }] = cache.eval.mock.calls[0];

            expect(script).toContain('DECRBY');
            expect(keys).toEqual([`mms-scans:${from}`]);
            expect(args).toEqual(['2']);
        });

        it('only logs a failed refund', async () => {
            const err = new Error('READONLY');

            cache.eval.mockRejectedValue(err);

            await expect(replyLimits.refundScans(from, 2)).resolves.toBeUndefined();
            expect(log.warn).toHaveBeenCalledWith({ err, from }, expect.any(String));
        });
    });
});
