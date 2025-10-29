import throttle from '../helpers/throttle.js';

const root = {
    async findPlayers({ displayName, pageNumber = 0 }, context) {
        const players = await context
            .destiny2Service.constructor.findPlayers(displayName, pageNumber);

        await throttle(players.map(async player => {
            const { displayName: activeDisplayName, membershipId, membershipType } = player
                .destinyMemberships
                .find(membership => membership.crossSaveOverride === membership.membershipType
                    || membership.crossSaveOverride === 0) || {};
            const statistics = await context.destiny2Service
                .getPlayerStatistics(membershipId, membershipType);
            const user = context.isAdministrator && activeDisplayName ? await context.userService
                .getUserByDisplayName(activeDisplayName, membershipType) : null;

            return Object.assign(player, { statistics, user });
        }), 11, 2);

        return players;
    },
};

export default root;
