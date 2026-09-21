// @ts-check
/**
 * The consent gate for asynchronous, non-transactional sends.
 *
 * Consent is filtered once at enqueue time - `getSubscribedUsers` excludes
 * opted-out users and joins on `notifications.enabled` - but a queued job can
 * execute minutes later, and a deferred MMS reply waits on an image download
 * and an AI call before it answers. Either window is long enough for a STOP to
 * arrive, so the state is read again here, immediately before the send.
 *
 * This asks whether consent has been *withdrawn* since the work was queued,
 * not whether the user was eligible for it in the first place. Eligibility is
 * settled at enqueue; repeating it here would duplicate rules that can then
 * drift apart. That is why only an explicit `enabled: false` suppresses below
 * and a missing vendor entry does not - see the comment on that check.
 *
 * The read is of Cosmos, which is where consent is durable but not where it
 * arrives first: a STOP is acknowledged before its write is applied, so a job
 * executing inside that queue latency can still read stale permission. See
 * #739.
 *
 * @module consent
 */
import log from './log.js';

/** @typedef {import('../users/user.service.js').default} UserService */

/**
 * @typedef {Object} ConsentQuery
 * @property {UserService} users
 * @property {string} phoneNumber
 * @property {string} [notificationType] - Omitted for a reply that belongs to
 * no vendor, such as the MMS roster, where only global consent applies.
 */

/**
 * Whether an alert may still be delivered to this number.
 *
 * Suppresses when consent storage cannot be reached, and when the account has
 * gone: neither can be read as permission, and an unwanted message after a
 * STOP is the one outcome here that cannot be taken back.
 *
 * @param {ConsentQuery} query
 * @returns {Promise<boolean>}
 */
const mayDeliver = async ({ users, phoneNumber, notificationType }) => {
    let user;

    try {
        /**
         * Read through to Cosmos rather than the cache, for the same reason
         * `applyConsent` does: a cached document can be an hour old, which is
         * longer than the window this check exists to close - it would happily
         * report the consent the STOP just replaced.
         */
        user = await users.getUserByPhoneNumber(phoneNumber, true);
    } catch (err) {
        log.warn(
            { err, phoneNumber, notificationType },
            'Consent could not be read; suppressing the notification.',
        );

        return false;
    }

    if (!user) {
        log.info(
            { phoneNumber, notificationType },
            'Suppressing the notification: no account for this number.',
        );

        return false;
    }

    if (user.isSubscribed === false) {
        log.info(
            { phoneNumber, notificationType },
            'Suppressing the notification: the sender has opted out.',
        );

        return false;
    }

    /**
     * Only an explicit `enabled: false` counts as a withdrawal. A missing
     * entry is not one: `POST /notifications/:subscription/:phoneNumber`
     * enqueues without requiring an entry at all, and names the type by key
     * ('Gunsmith') where a stored entry holds the value ('Banshee-44'), so a
     * lookup miss is the normal case on that route rather than a signal.
     */
    if (notificationType) {
        const preference = user.notifications?.find(({ type }) => type === notificationType);

        if (preference?.enabled === false) {
            log.info(
                { phoneNumber, notificationType },
                'Suppressing the notification: the sender disabled this vendor.',
            );

            return false;
        }
    }

    return true;
};

export default mayDeliver;
