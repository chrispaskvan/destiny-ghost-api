import pLimit from 'p-limit';

const root = {
    async findPlayers({ displayName, pageNumber = 0 }, context) {
        const players = await context.destiny2Service.constructor.findPlayers(
            displayName,
            pageNumber,
        );

        const limit = pLimit(11);

        return Promise.all(
            players.map(player =>
                limit(async () => {
                    const {
                        displayName: activeDisplayName,
                        membershipId,
                        membershipType,
                    } = player.destinyMemberships.find(
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
                                  membershipType,
                              )
                            : null;

                    return Object.assign(player, { statistics, user });
                }),
            ),
        );
    },
};

export default root;
