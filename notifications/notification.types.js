// @ts-check
/**
 * The notification types there is a sender for: the only ones offered on a
 * profile, accepted by the notification routes, or queued.
 * @type {{ Xur: string }}
 */
const notificationTypes = {
    Xur: 'Xur',
};

/**
 * Whether a notification type, named by its value, has a sender.
 * @param {unknown} type
 * @returns {type is string}
 */
export const isSupportedNotificationType = type =>
    Object.values(notificationTypes).some(supported => supported === type);

export default notificationTypes;
