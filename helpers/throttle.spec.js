/**
 * Token Tests
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
    });
});
