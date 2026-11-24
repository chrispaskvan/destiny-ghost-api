import { describe, expect, it } from 'vitest';
import cleanPhoneNumber from './clean-phone-number.js';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';

describe('cleanPhoneNumber', () => {
    it('should return E.164', () => {
        expect(cleanPhoneNumber('+1 (208) 555-0123')).toEqual('+12085550123');
    });

    it('should assume +1 without a country code', () => {
        expect(cleanPhoneNumber('2085550123')).toEqual('+12085550123');
    });

    it('should accept a Canadian number', () => {
        expect(cleanPhoneNumber('+1 416 555 0123')).toEqual('+14165550123');
    });

    it('should leave a number already in E.164 as it is', () => {
        expect(cleanPhoneNumber('+12085550123')).toEqual('+12085550123');
    });

    it.each(['not a number', '123', '+1 000 000 0000'])(
        'should reject an unusable number %j',
        phoneNumber => {
            expect(() => cleanPhoneNumber(phoneNumber)).toThrow(InvalidPhoneNumberError);
        },
    );

    it.each([
        ['CN', '+86 10 1234 5678'],
        ['GB', '+44 20 7946 0958'],
        ['KP', '+850 2 381 2321'],
        ['RU', '+7 495 123 4567'],
    ])('should reject a number from an unsupported region (%s)', (_, phoneNumber) => {
        expect(() => cleanPhoneNumber(phoneNumber)).toThrow(InvalidPhoneNumberError);
    });

    /**
     * The rest of the +1 plan is where a number given without a country
     * code lands outside the US and Canada, and its high-cost ranges are a
     * favourite of pumping schemes.
     */
    it.each([
        ['AG', '+1 268 464 1234'],
        ['AG', '2684641234'],
        ['JM', '+1 876 927 1234'],
        ['JM', '8769271234'],
    ])('should reject a +1 number outside the US and Canada (%s %s)', (_, phoneNumber) => {
        expect(() => cleanPhoneNumber(phoneNumber)).toThrow(InvalidPhoneNumberError);
    });
});
