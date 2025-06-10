import { post } from './request';

class DirectorClient {
    query = 'query FindPlayersHeroNameAndFriends($displayName: String!) { findPlayers(displayName: $displayName) { bungieGlobalDisplayName bungieGlobalDisplayNameCode destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } statistics { pvp { kdr highestLightLevel } } user { firstName lastName } } }';

    async findPlayers(displayName, cookies) {
        const cookieHeader = Object.entries(cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
        const headers = {
            'Content-Type': 'application/json',
            cookie: cookieHeader
        };
        const graphql = JSON.stringify({
            query: "query FindPlayersHeroNameAndFriends($displayName: String!) { findPlayers(displayName: $displayName) { bungieGlobalDisplayName bungieGlobalDisplayNameCode destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } destinyMemberships { crossSaveOverride membershipType membershipId displayName bungieGlobalDisplayName bungieGlobalDisplayNameCode } statistics { pvp { kdr highestLightLevel } } user { firstName lastName } } }",
            variables: { displayName }
        });
        const responseBody = await post({
            url: `${process.env.PROTOCOL}://api2.destiny-ghost.com/director`,
            headers,
            data: graphql,
            redirect: 'follow'
        });

        return responseBody.data.findPlayers?.[0]?.statistics; // Return the statistics of the first player
    }
}

export default DirectorClient;
