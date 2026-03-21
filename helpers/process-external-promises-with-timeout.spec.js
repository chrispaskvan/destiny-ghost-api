import {
    describe, expect, it,
} from 'vitest';

import processExternalPromisesWithTimeout from './process-external-promises-with-timeout.js';

describe('processExternalPromisesWithTimeout', () => {
    it('should resolve all promises within the timeout', async () => {
        const promises = [
            new Promise(resolve => setTimeout(() => resolve('result1'), 100)),
            new Promise(resolve => setTimeout(() => resolve('result2'), 200)),
        ];

        const results = await processExternalPromisesWithTimeout(promises, 500);

        expect(results).toEqual([
            { status: 'fulfilled', value: 'result1' },
            { status: 'fulfilled', value: 'result2' },
        ]);
    });

    it('should return timed-out for promises that take longer than the timeout', async () => {
        const promises = [
            new Promise(resolve => setTimeout(() => resolve('result1'), 100)),
            new Promise(resolve => setTimeout(() => resolve('result2'), 2000)),
        ];

        const results = await processExternalPromisesWithTimeout(promises, 500);

        expect(results).toEqual([
            { status: 'fulfilled', value: 'result1' },
            { status: 'timed-out' },
        ]);
    });

    it('should handle empty array of promises', async () => {
        const results = await processExternalPromisesWithTimeout([], 500);

        expect(results).toEqual([]);
    });

    it('should return rejected with reason for promises that reject', async () => {
        const promises = [
            new Promise((_, reject) => setTimeout(() => reject(new Error('error1')), 100)),
            new Promise(resolve => setTimeout(() => resolve('result2'), 200)),
        ];

        const results = await processExternalPromisesWithTimeout(promises, 500);

        expect(results).toEqual([
            { status: 'rejected', reason: new Error('error1') },
            { status: 'fulfilled', value: 'result2' },
        ]);
    });
});
