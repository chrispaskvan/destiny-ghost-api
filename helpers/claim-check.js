import { createId } from '@paralleldrive/cuid2';
import cache from './cache';

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
        await cache.expire(this.#number, 86400); // 1 day
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

export default ClaimCheck;
