/**
 * Token Tests
 */
import {
    describe, expect, it,
} from 'vitest';
import { getBlob, getCode } from './tokens';

describe('Tokens', () => {
    describe('getBlob', () => {
        it('should return a blob', () => {
            const blob = getBlob();

            expect(blob).toBeDefined();
        });
    });
    describe('getCode', () => {
        describe('when a code is requested without specifying a length', () => {
            it('should return a code with the default length of 6', () => {
                const token = getCode();

                expect(token.length).toEqual(6);
            });
        });
        describe('when the number of characters in the code is specified', () => {
            it('should return a code of the specified length', () => {
                const size = 12;
                const token = getCode(size);

                expect(token.length).toEqual(size);
            });
        });
    });
});
