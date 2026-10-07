// @ts-check
import { createId } from '@paralleldrive/cuid2';
import cache from './cache.js';

const claimCheckExpiration = 86400; // 1 day in seconds

/**
 * The outcome recorded when a send was abandoned because consent no longer
 * permitted it. Every other status this hash holds comes from Twilio, so
 * without one of our own a suppressed send is indistinguishable from one that
 * was never attempted.
 */
const SKIPPED = 'skipped';

/**
 * The outcome recorded when a recipient was already queued for the same
 * event by another operation - a second broadcast for the same week, or a
 * retry of one whose reservation lapsed - so this one queued nothing for
 * them. Their delivery is reported on that other operation's receipt.
 */
const DUPLICATE = 'duplicate';

class ClaimCheck {
    /**
     * Claim Check Number
     */
    #number;

    /**
     * @param {string} [number] - an operation's id, when the caller has
     * already minted one; a new id otherwise
     */
    constructor(number = createId()) {
        this.#number = number;
    }

    get number() {
        return this.#number;
    }

    /**
     * @param {string} phoneNumber
     * @param {string} [status]
     */
    async addPhoneNumber(phoneNumber, status = 'queued') {
        await cache.hSet(this.#number, phoneNumber, status);
        await cache.expire(this.#number, claimCheckExpiration);
    }

    /** @param {string} number */
    static async getClaimCheck(number) {
        return await cache.hGetAll(number);
    }

    /**
     * @param {string} claimCheckNumber
     * @param {string} phoneNumber
     * @param {string} status
     */
    static async updatePhoneNumber(claimCheckNumber, phoneNumber, status) {
        const claimCheck = await cache.hGet(claimCheckNumber, phoneNumber);

        if (claimCheck) await cache.hSet(claimCheckNumber, phoneNumber, status);

        return claimCheck;
    }
}

export { ClaimCheck as default, claimCheckExpiration, DUPLICATE, SKIPPED };
