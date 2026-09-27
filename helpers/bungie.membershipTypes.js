// @ts-check
/**
 * The Bungie platform values this application signs users in on, a subset of
 * Bungie's `BungieMembershipType` enum.
 *
 * Deliberately not every value the enum defines: 0 (None) and 254 (BungieNext)
 * are not playable platforms, 4 (Blizzard) was migrated to Steam in 2019, 5
 * (Stadia) retired with the service in 2023, and 10 (Demon) is internal. A
 * membership on one of those is not something a Destiny player can log into
 * today, so it is treated as no playable membership rather than accepted and
 * stored.
 *
 * @type {readonly [1, 2, 3, 6]}
 */
const supportedMembershipTypes = /** @type {const} */ ([
    1, // Xbox
    2, // PlayStation Network
    3, // Steam
    6, // Epic Games Store
]);

/**
 * One of the platform values above.
 * @typedef {(typeof supportedMembershipTypes)[number]} SupportedMembershipType
 */

export default supportedMembershipTypes;
