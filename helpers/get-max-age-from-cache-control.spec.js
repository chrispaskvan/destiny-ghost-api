import {
    describe, expect, it,
} from 'vitest';
import getMaxAgeFromCacheControl from './get-max-age-from-cache-control';

describe('getMaxAgeFromCacheControl()', () => {
    describe('when max-age is included and is a number', () => {
        it('should return the max-age as a number', () => {
            const maxAge1 = 0;
            const header = `public, max-age=${maxAge1}, immutable`;

            const maxAge = getMaxAgeFromCacheControl(header);

            expect(maxAge).toEqual(maxAge1);
            expect(Number.isNaN(maxAge)).toBeFalsy();
        });
    });

    describe('when max-age is not included', () => {
        it('should return undefined', () => {
            const header = 'no-cache, no-store';

            const maxAge = getMaxAgeFromCacheControl(header);

            expect(maxAge).toBeUndefined();
        });
    });

    describe('when max-age is not a number', () => {
        it('should return undefined', () => {
            const header = 'public, max-age=something';

            const maxAge = getMaxAgeFromCacheControl(header);

            expect(maxAge).toBeUndefined();
        });
    });
});
