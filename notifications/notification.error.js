// @ts-check
/**
 * Notification Error Class
 */
class NotificationError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);

        Object.assign(this, {
            name: 'NotificationError',
        });
    }
}

export default NotificationError;
