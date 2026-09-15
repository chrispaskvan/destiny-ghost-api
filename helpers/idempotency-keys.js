// @ts-check
import cache from './cache.js';

/** @param {unknown} idempotencyKey */
const getIdempotencyKey = async idempotencyKey => {
    if (!(idempotencyKey && typeof idempotencyKey === 'string')) {
        throw new Error('idempotencyKey is a required string');
    }

    return await cache.get(idempotencyKey);
};

/**
 * @param {unknown} idempotencyKey
 * @param {unknown} claimCheckNumber
 */
const setIdempotencyKey = async (idempotencyKey, claimCheckNumber) => {
    if (!(idempotencyKey && typeof idempotencyKey === 'string')) {
        throw new Error('idempotencyKey is a required string');
    }

    if (!(claimCheckNumber && typeof claimCheckNumber === 'string')) {
        throw new Error('claimCheckNumber is a required string');
    }

    await cache.set(idempotencyKey, claimCheckNumber);

    return await cache.expire(idempotencyKey, 86400); // 1 day
};

export { getIdempotencyKey, setIdempotencyKey };
