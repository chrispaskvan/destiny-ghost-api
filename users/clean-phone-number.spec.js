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

    it('should keep a country code it is given', () => {
        expect(cleanPhoneNumber('+44 20 7946 0958')).toEqual('+442079460958');
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
        ['KP', '+850 2 381 2321'],
        ['RU', '+7 495 123 4567'],
    ])('should reject a number from a barred region (%s)', (_, phoneNumber) => {
        expect(() => cleanPhoneNumber(phoneNumber)).toThrow(InvalidPhoneNumberError);
    });
});
