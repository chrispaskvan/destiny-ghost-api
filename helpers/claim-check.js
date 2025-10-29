import { createId } from '@paralleldrive/cuid2/index.js';
import cache from './cache.js';

const claimCheckExpiration = 86400; // 1 day in seconds

class ClaimCheck {
    /**
     * Claim Check Number
     * @private
     */
    #number = createId();

    get number() {
        return this.#number;
    }

    async addPhoneNumber(phoneNumber, status = 'queued') {
        await cache.hSet(this.#number, phoneNumber, status);
        await cache.expire(this.#number, claimCheckExpiration);
    }

    static async getClaimCheck(number) {
        return await cache.hGetAll(number);
    }

    static async updatePhoneNumber(claimCheckNumber, phoneNumber, status) {
        const claimCheck = await cache.hGet(claimCheckNumber, phoneNumber);

        if (claimCheck) await cache.hSet(claimCheckNumber, phoneNumber, status);

        return claimCheck;
    }
}

export { ClaimCheck as default, claimCheckExpiration };
