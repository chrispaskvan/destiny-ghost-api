// @ts-check
/**
 * What Xur is selling, looked up the same way for every channel that asks:
 * the REST and MCP endpoints, an SMS request, and a notification. Each caller
 * keeps its own wording, consent, and error replies.
 *
 * @module XurInventory
 */

/** @typedef {import('../helpers/world2.js').ItemDefinition} ItemDefinition */

/**
 * @typedef {Object} XurSources
 * @property {Pick<import('./destiny2.service.js').default, 'getProfile' | 'getXur'>} destiny
 * @property {Pick<import('../helpers/world2.js').default, 'getItemByHash' | 'getWeaponCategory'>} world
 */

/**
 * @typedef {Object} XurMember
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} accessToken
 * @property {string} [characterId] - Defaults to the member's first character.
 */

/**
 * Xur's inventory for a member, as manifest item definitions. Items the
 * manifest does not know are left out.
 *
 * @param {XurSources} sources
 * @param {XurMember} member
 * @returns {Promise<ItemDefinition[] | undefined>} `undefined` when the member
 * has no characters to ask about.
 */
const getXurInventory = async (
    { destiny, world },
    { membershipId, membershipType, accessToken, characterId },
) => {
    const characters = await destiny.getProfile(membershipId, membershipType);

    if (!characters?.length) return undefined;

    const itemHashes = await destiny.getXur(
        membershipId,
        membershipType,
        characterId || characters[0].characterId,
        accessToken,
    );
    const items = await Promise.all(itemHashes.map(itemHash => world.getItemByHash(itemHash)));

    return items.filter(
        /** @returns {item is ItemDefinition} */
        item => Boolean(item),
    );
};

/**
 * The weapons in Xur's inventory for a member.
 *
 * @param {XurSources} sources
 * @param {XurMember} member
 * @returns {Promise<ItemDefinition[] | undefined>} `undefined` when the member
 * has no characters to ask about.
 */
const getXurWeapons = async (sources, member) => {
    const items = await getXurInventory(sources, member);

    if (!items) return undefined;

    const weaponCategory = await sources.world.getWeaponCategory();

    return items.filter(({ itemCategoryHashes = [] }) =>
        itemCategoryHashes.includes(weaponCategory),
    );
};

export { getXurInventory, getXurWeapons };
