import { describe, expect, it } from 'vitest';
import readEventLoopDelay from './event-loop-delay.js';

describe('readEventLoopDelay', () => {
    it('should report a synchronous block, then start over', async () => {
        const blockedFor = 100;

        readEventLoopDelay();
        // the histogram discards the first interval after a reset
        await new Promise(resolve => setTimeout(resolve, 30));

        const start = performance.now();

        while (performance.now() - start < blockedFor) {
            // block the event loop
        }
        // let the histogram's timer run and record how late it was
        await new Promise(resolve => setTimeout(resolve, 30));

        const delay = readEventLoopDelay();

        expect(delay.max).toBeGreaterThanOrEqual(blockedFor / 2);
        expect(delay.p50).toBeLessThan(blockedFor / 2);
        expect(readEventLoopDelay().max).toBeLessThan(delay.max);
    });

    it('should read an idle loop as no delay, not as its 10 ms resolution', async () => {
        readEventLoopDelay();
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(readEventLoopDelay().p50).toBeLessThan(5);
    });
});
