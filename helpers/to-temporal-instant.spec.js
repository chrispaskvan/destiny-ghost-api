import { describe, expect, it } from 'vitest';
import toTemporalInstant from './to-temporal-instant';

describe('toTemporalInstant', () => {
    describe('when given a valid HTTP date string', () => {
        it('should return the corresponding Temporal.Instant', () => {
            const instant = toTemporalInstant('Sat, 25 Apr 2020 17:00:00 GMT');

            expect(instant.epochMilliseconds).toEqual(new Date('2020-04-25T17:00:00.000Z').getTime());
        });
    });

    describe('when given a valid ISO date string', () => {
        it('should return the corresponding Temporal.Instant', () => {
            const instant = toTemporalInstant('2020-04-25T17:00:00.000Z');

            expect(instant.epochMilliseconds).toEqual(new Date('2020-04-25T17:00:00.000Z').getTime());
        });
    });

    describe('when given null', () => {
        it('should return the Unix epoch', () => {
            const instant = toTemporalInstant(null);

            expect(instant.epochMilliseconds).toEqual(0);
        });
    });

    describe('when given undefined', () => {
        it('should return the Unix epoch', () => {
            const instant = toTemporalInstant(undefined);

            expect(instant.epochMilliseconds).toEqual(0);
        });
    });

    describe('when given an invalid date string', () => {
        it('should return the Unix epoch', () => {
            const instant = toTemporalInstant('not-a-date');

            expect(instant.epochMilliseconds).toEqual(0);
        });
    });
});
