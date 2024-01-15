import {
    describe, expect, it,
} from 'vitest';
import ClaimCheck from './claim-check';

const claimCheck = new ClaimCheck();

describe('ClaimCheck', () => {
    it('should return a claim check number', () => {
        const { number } = claimCheck;

        expect(number).toBeTruthy();
    });
});
