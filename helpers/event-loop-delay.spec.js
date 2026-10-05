import { createServer } from 'node:http';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
     * The order start.js runs in: this module first, then every other module
     * evaluating synchronously, then startServer listening - its callback can
     * run before any timer has, as here.
     */
    describe('when startup blocks the loop before the server listens', () => {
        let startup;
        let runtime;

        beforeAll(async () => {
            vi.resetModules();
            const { default: read, readStartupEventLoopDelay } = await import(
                './event-loop-delay.js'
            );
            const blockedAt = performance.now();

            while (performance.now() - blockedAt < 300) {
                // the modules imported after it, evaluating
            }

            const server = createServer();

            startup = await new Promise(resolve => {
                server.listen(0, '127.0.0.1', () => resolve(readStartupEventLoopDelay()));
            });
            server.close();
            await new Promise(resolve => setTimeout(resolve, 50));
            runtime = read();
        });

        it('should report the stall as startup', () => {
            expect(startup.max).toBeGreaterThanOrEqual(250);
        });

        it('should leave it out of the first runtime read', () => {
            expect(runtime.max).toBeLessThan(250);
        });
    });
});
