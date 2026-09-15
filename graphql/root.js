// @ts-check
import pLimit from 'p-limit';

/**
 * @typedef {Object} GraphQLContext
 * @property {import('../destiny2/destiny2.service.js').default} destiny2Service
 * @property {boolean} isAdministrator
 * @property {import('../users/user.service.js').default} userService
 */

const root = {
    /**
     * @param {{ displayName: string, pageNumber?: number }} args
     * @param {GraphQLContext} context
     */
    async findPlayers({ displayName, pageNumber = 0 }, context) {
        const players =
            await /** @type {typeof import('../destiny2/destiny2.service.js').default} */ (
                context.destiny2Service.constructor
            ).findPlayers(displayName, pageNumber);

        const limit = pLimit(11);

        return Promise.all(
            players.map(player =>
                limit(async () => {
                    const {
                        displayName: activeDisplayName,
                        membershipId,
                        membershipType,
                    } = (player.destinyMemberships ?? []).find(
                        membership =>
                            membership.crossSaveOverride === membership.membershipType ||
                            membership.crossSaveOverride === 0,
                    ) || {};
                    const statistics = await context.destiny2Service.getPlayerStatistics(
                        membershipId,
                        membershipType,
                    );
                    const user =
                        context.isAdministrator && activeDisplayName
                            ? await context.userService.getUserByDisplayName(
                                  activeDisplayName,
                                  // displayName/membershipId/membershipType all come from the
                                  // same found membership, so activeDisplayName being defined
                                  // guarantees membershipType is too.
                                  /** @type {number} */ (membershipType),
                              )
                            : null;

                    return Object.assign(player, { statistics, user });
                }),
            ),
        );
    },
};

export default root;
