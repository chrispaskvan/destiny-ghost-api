/**
 * Notification Error Class
 */
class NotificationError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     *
     * @param code
     * @param message
     * @param status
     */
    constructor(message) {
        super(message);

        Object.assign(this, {
            name: 'NotificationError',
        });
    }
}

export default NotificationError;
