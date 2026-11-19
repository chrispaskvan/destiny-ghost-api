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
 * A vendor alert goes out only to a user whose entry for that vendor says
 * `enabled: true`, checked here because one route queues a single recipient
 * without consulting their preferences at all.
 *
 * Two sources, because consent becomes durable somewhere other than where it
 * arrives. A STOP is acknowledged before its write is applied, so Cosmos alone
 * would report permission the sender has already withdrawn. The marker
 * `helpers/consent-marker.js` leaves at acknowledgement covers exactly that
 * gap, and `consentUpdatedAt` says when it stops mattering.
 *
 * @module consent
 */
import { readConsent } from './consent-marker.js';
import log from './log.js';

/** @typedef {import('../users/user.service.js').default} UserService */

/**
 * @typedef {Object} ConsentQuery
 * @property {UserService} users
 * @property {string} phoneNumber
 * @property {string} [notificationType] - Omitted for a reply that belongs to
 * no vendor, such as the MMS roster, where only global consent applies.
 * @property {boolean} [throwIfUnreadable] - Reject with the storage error
 * instead of suppressing, for a caller that can try again later rather than
 * lose the work.
 */

/**
 * Whether an alert may still be delivered to this number.
 *
 * Suppresses when consent storage cannot be reached, unless asked to throw,
 * and when the account has gone: neither can be read as permission, and an
 * unwanted message after a STOP is the one outcome here that cannot be taken
 * back.
 *
 * @param {ConsentQuery} query
 * @returns {Promise<boolean>}
 */
const mayDeliver = async ({ users, phoneNumber, notificationType, throwIfUnreadable = false }) => {
    let user;
    /** @type {import('./consent-marker.js').ConsentMarker | undefined} */
    let marker;

    try {
        /**
         * Together rather than in sequence: this runs once the send path's
         * rate limiter has granted the send, immediately before it, and two
         * round trips back to back would widen the gap a STOP can still land
         * in. `readConsent` never rejects, so only the Cosmos read can fail
         * this.
         *
         * Read from Cosmos rather than the cache: a cached document can be an
         * hour old, which is longer than the window this check exists to close
         * - it would happily report the consent the STOP just replaced. The
         * projection keeps that read to the fields decided on below, since a
         * broadcast runs it once per message.
         */
        [marker, user] = await Promise.all([
            readConsent(phoneNumber),
            users.getConsentByPhoneNumber(phoneNumber),
        ]);
    } catch (err) {
        if (throwIfUnreadable) {
            throw err;
        }

        log.warn(
            { err, phoneNumber, notificationType },
            'Consent could not be read; suppressing the notification.',
        );

        return false;
    }

    /**
     * An acknowledgement the stored document has not caught up with yet. The
     * comparison is `applyConsent`'s own rule, read from the other side:
     * strictly older loses, and a tie means the write has landed, so the
     * marker has nothing left to add and Cosmos decides. That is what keeps a
     * marker from stranding anyone - it goes inert on its own, rather than
     * relying on its expiry.
     *
     * A marker with no stored document behind it still counts. An account can
     * be registered between the STOP and the send, and the sender's intent
     * arrived first either way.
     */
    const pending =
        marker &&
        (typeof user?.consentUpdatedAt !== 'number' || marker.receivedAt > user.consentUpdatedAt)
            ? marker
            : undefined;

    if (pending && !pending.isSubscribed) {
        log.info(
            { phoneNumber, notificationType },
            'Suppressing the notification: the sender opted out and the write has not landed yet.',
        );

        return false;
    }

    if (!user) {
        /**
         * A pending START cannot make an account exist, so there is still
         * nobody to deliver to.
         */
        log.info(
            { phoneNumber, notificationType },
            'Suppressing the notification: no account for this number.',
        );

        return false;
    }

    /**
     * A pending START outranks a stored opt-out for the same reason a pending
     * STOP outranks stored permission: it is the newer intent, and the sender
     * has already been told it applied.
     */
    if (user.isSubscribed === false && !pending?.isSubscribed) {
        log.info(
            { phoneNumber, notificationType },
            'Suppressing the notification: the sender has opted out.',
        );

        return false;
    }

    /**
     * Opt-in, not opt-out: a missing entry, or one without `enabled: true`,
     * is not permission.
     */
    if (notificationType) {
        const preference = user.notifications?.find(({ type }) => type === notificationType);

        if (preference?.enabled !== true) {
            log.info(
                { phoneNumber, notificationType },
                'Suppressing the notification: the sender has not enabled this vendor.',
            );

            return false;
        }
    }

    return true;
};

export default mayDeliver;
