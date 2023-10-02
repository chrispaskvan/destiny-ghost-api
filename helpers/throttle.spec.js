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

            // const results = await Promise.allSettled(tasks);
            const results = await throttle(tasks, 2);

            expect(results.length).toEqual(count + 1);
            expect(results.filter(({ status }) => status === 'fulfilled').length).toEqual(count);
            expect(results.filter(({ status }) => status === 'rejected').length).toEqual(1);
        });
    });
});
