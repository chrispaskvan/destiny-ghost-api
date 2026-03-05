/**
 * Throttle Tests
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import throttle from './throttle';

describe('throttle()', () => {
    describe('when throttling tasks', () => {
        it('should return an array of tasks once throttling completes', async () => {
            const count = 11;
            const failure = () => Promise.reject(new Error('Thorn'));
            const success = () => Promise.resolve('Malfeasance');
            const tasks = Array(count).fill(success());

            tasks.push(failure());

            const results = await throttle(tasks, 2);

            expect(results.length).toEqual(count + 1);
            expect(results.filter(({ status }) => status === 'fulfilled').length).toEqual(count);
            expect(results.filter(({ status }) => status === 'rejected').length).toEqual(1);
        });

        it('should return an empty array when given no tasks', async () => {
            const results = await throttle([], 2);

            expect(results).toEqual([]);
        });

        it('should preserve result values in order', async () => {
            const tasks = [
                Promise.resolve('first'),
                Promise.resolve('second'),
                Promise.resolve('third'),
            ];

            const results = await throttle(tasks, 1);

            expect(results[0]).toEqual({ status: 'fulfilled', value: 'first' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'second' });
            expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' });
        });

        it('should capture rejection reasons', async () => {
            const tasks = [Promise.reject(new Error('Thorn'))];

            const results = await throttle(tasks, 1);

            expect(results[0].status).toBe('rejected');
            expect(results[0].reason.message).toBe('Thorn');
        });

        it('should preserve order across batches with mixed results', async () => {
            const tasks = [
                Promise.resolve('a'),
                Promise.reject(new Error('b-error')),
                Promise.resolve('c'),
                Promise.resolve('d'),
            ];

            const results = await throttle(tasks, 2);

            expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
            expect(results[1].status).toBe('rejected');
            expect(results[1].reason.message).toBe('b-error');
            expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
            expect(results[3]).toEqual({ status: 'fulfilled', value: 'd' });
        });

        it('should handle concurrency larger than the number of tasks', async () => {
            const tasks = [
                Promise.resolve('x'),
                Promise.resolve('y'),
            ];

            const results = await throttle(tasks, 10);

            expect(results.length).toBe(2);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'x' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'y' });
        });
    });

    describe('when using the wait parameter', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should delay between tasks when wait is provided', async () => {
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
            ];
            const promise = throttle(tasks, 1, 100);

            await vi.advanceTimersByTimeAsync(200);

            const results = await promise;

            expect(results.length).toBe(2);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'b' });
        });

        it('should call setTimeout with the wait value', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
            ];
            const promise = throttle(tasks, 1, 50);

            await vi.advanceTimersByTimeAsync(200);
            await promise;

            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
            setTimeoutSpy.mockRestore();
        });

        it('should not delay when wait is not a valid number', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
            ];
            const promise = throttle(tasks, 1, 'invalid');

            await vi.advanceTimersByTimeAsync(100);

            const results = await promise;

            expect(results.length).toBe(2);
            // setTimeout should not have been called with the invalid wait value
            expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 'invalid');
            setTimeoutSpy.mockRestore();
        });

        it('should apply wait once between two batches, not after every task', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
                Promise.resolve('c'),
                Promise.resolve('d'),
            ];
            // concurrency=2 → 2 batches: [a,b] then [c,d]; wait fires once between them
            const promise = throttle(tasks, 2, 50);

            await vi.advanceTimersByTimeAsync(100);
            const results = await promise;

            expect(results.length).toBe(4);
            // Only one sleep between the two batches
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
            setTimeoutSpy.mockRestore();
        });

        it('should not apply wait before the first batch', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [Promise.resolve('only')];
            const promise = throttle(tasks, 1, 100);

            // No timer advancement needed – no sleep for the first (and only) batch
            const results = await promise;

            expect(results.length).toBe(1);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'only' });
            // setTimeout should never be called when there is only one batch
            expect(setTimeoutSpy).not.toHaveBeenCalled();
            setTimeoutSpy.mockRestore();
        });

        it('should apply wait N-1 times for N batches', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [
                Promise.resolve(1),
                Promise.resolve(2),
                Promise.resolve(3),
                Promise.resolve(4),
                Promise.resolve(5),
            ];
            // concurrency=2 → 3 batches: [1,2], [3,4], [5]; wait fires twice
            const promise = throttle(tasks, 2, 30);

            await vi.advanceTimersByTimeAsync(200);
            const results = await promise;

            expect(results.length).toBe(5);
            expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
            setTimeoutSpy.mockRestore();
        });

        it('should complete without errors when wait is not provided', async () => {
            const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
            const tasks = [
                Promise.resolve('p'),
                Promise.resolve('q'),
                Promise.resolve('r'),
            ];

            const results = await throttle(tasks, 2);

            expect(results.length).toBe(3);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'p' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'q' });
            expect(results[2]).toEqual({ status: 'fulfilled', value: 'r' });
            expect(setTimeoutSpy).not.toHaveBeenCalled();
            setTimeoutSpy.mockRestore();
        });
    });
});
