import { describe, expect, it } from 'vitest';
import isNotModified from './is-not-modified.js';

const lastModified = 'Sat, 25 Apr 2020 17:00:00 GMT';

describe('isNotModified', () => {
    describe('when If-Modified-Since equals Last-Modified', () => {
        it('should return true', () => {
            expect(isNotModified(lastModified, lastModified)).toBe(true);
        });
    });

    describe('when If-Modified-Since is after Last-Modified', () => {
        it('should return true', () => {
            expect(isNotModified('Sat, 25 Apr 2020 17:00:01 GMT', lastModified)).toBe(true);
        });
    });

    describe('when If-Modified-Since is before Last-Modified', () => {
        it('should return false', () => {
            expect(isNotModified('Sat, 25 Apr 2020 16:59:59 GMT', lastModified)).toBe(false);
        });
    });

    describe('when If-Modified-Since is missing', () => {
        it('should return false', () => {
            expect(isNotModified(undefined, lastModified)).toBe(false);
        });
    });

    describe('when If-Modified-Since is not a date', () => {
        it('should return false', () => {
            expect(isNotModified('yesterday', lastModified)).toBe(false);
        });
    });

    describe('when Last-Modified is missing', () => {
        it('should return false', () => {
            expect(isNotModified(lastModified, undefined)).toBe(false);
        });
    });

    describe('when neither date is present', () => {
        it('should return false', () => {
            expect(isNotModified(undefined, undefined)).toBe(false);
        });
    });
});
