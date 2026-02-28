/**
 * Token Tests
 */
import {
    describe, expect, it,
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
        it('should delay between tasks when wait is provided', async () => {
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
            ];

            const results = await throttle(tasks, 1, 10);

            expect(results.length).toBe(2);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'b' });
        });

        it('should not delay when wait is not a valid number', async () => {
            const tasks = [
                Promise.resolve('a'),
                Promise.resolve('b'),
            ];

            const results = await throttle(tasks, 1, 'invalid');

            expect(results.length).toBe(2);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
            expect(results[1]).toEqual({ status: 'fulfilled', value: 'b' });
        });
    });
});
