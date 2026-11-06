// @ts-check
import { parsePhoneNumber } from 'awesome-phonenumber';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';

/**
 * Normalize a phone number to E.164, assuming +1 when no country code is
 * given, and reject one that can't be used: unparseable, or from a region
 * the service does not deliver to.
 *
 * Shared by the sign-up route, which checks the number before the sign-up
 * limit so a typo doesn't spend one, and `UserController.signUp`, which
 * matches stored numbers against the E.164 form.
 * @param {string} phoneNumber
 * @returns {string} the number in E.164
 * @throws {InvalidPhoneNumberError}
 */
const cleanPhoneNumber = phoneNumber => {
    const cleaned = parsePhoneNumber(phoneNumber[0] === '+' ? phoneNumber : `+1${phoneNumber}`);

    if (!cleaned.valid || ['CN', 'KP', 'RU'].includes(cleaned.regionCode)) {
        throw new InvalidPhoneNumberError('phone number is invalid', {
            cause: 'error' in cleaned ? cleaned.error : undefined,
        });
    }

    return cleaned.number.e164;
};

export default cleanPhoneNumber;
