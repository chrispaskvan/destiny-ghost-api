import { createId } from '@paralleldrive/cuid2';
import cache from './cache';

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
        await cache.hset(this.#number, phoneNumber, status);
        await cache.expire(this.#number, claimCheckExpiration);
    }

    static async getClaimCheck(number) {
        return await cache.hgetall(number);
    }

    static async updatePhoneNumber(claimCheckNumber, phoneNumber, status) {
        const claimCheck = await cache.hget(claimCheckNumber, phoneNumber);

        if (claimCheck) await cache.hset(claimCheckNumber, phoneNumber, status);

        return claimCheck;
    }
}

export { ClaimCheck as default, claimCheckExpiration };
