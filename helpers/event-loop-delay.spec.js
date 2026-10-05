import { describe, expect, it, vi } from 'vitest';
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

    /**
     * start.js imports this module first, then every other module is
     * evaluated synchronously in the same turn: that is the histogram's first
     * interval, which it discards.
     */
    it('should count a stall in the synchronous evaluation that follows it', async () => {
        vi.resetModules();
        const { default: readFresh } = await import('./event-loop-delay.js');
        const start = performance.now();

        while (performance.now() - start < 300) {
            // the modules imported after it, evaluating
        }
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(readFresh().max).toBeGreaterThanOrEqual(250);
        // Counted once, by the startup read
        expect(readFresh().max).toBeLessThan(250);
    });
});
