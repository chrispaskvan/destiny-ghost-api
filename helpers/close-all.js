// @ts-check

/**
 * Wait for every close to settle, then report any that failed.
 *
 * `Promise.all` rejects on the first failure while the others may still be
 * closing, and shutdown would then move on to quit connections they are
 * still using. Settling them all first keeps a failed close from cutting the
 * others' drain short.
 * @param {Promise<unknown>[]} closes
 * @param {string} message - describes the group, for the `AggregateError`
 * @returns {Promise<void>}
 */
const closeAll = async (closes, message) => {
    const results = await Promise.allSettled(closes);
    const failures = results
        .filter(result => result.status === 'rejected')
        .map(({ reason }) => reason);

    if (failures.length) {
        throw new AggregateError(failures, message);
    }
};

export default closeAll;
