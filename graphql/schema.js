// @ts-check
import { buildSchema } from 'graphql';

/**
 * Schema
 *   Players[]
 *     Player
 *       Memberships[]
 *         Membership
 *       Statistics
 *         PvPStatistics
 *     User
 */
const destinyGhostSchema = `
    type Membership {
        iconPath: String!
        crossSaveOverride: Int!
        membershipType: Int!
        membershipId: ID!
        displayName: String!
        bungieGlobalDisplayName: String!
        bungieGlobalDisplayNameCode: Int!
    }

    """
    Bungie's own display values, as they arrive: already rounded and formatted
    for reading. Declared as strings because that is what they are - typing them
    as numbers left GraphQL coercing every one on the way out, and a value
    Bungie chose to format with a separator would fail that coercion rather than
    be returned.
    """
    type PvPStatistics {
        combatRating: String
        efficiency: String
        highestLightLevel: String
        kda: String
        kdr: String
    }

    type Statistics {
        pvp: PvPStatistics!
    }

    type Player {
        bungieGlobalDisplayName: String!
        bungieGlobalDisplayNameCode: Int!
        bungieNetMembershipId: ID
        destinyMemberships: [Membership!]!
        statistics: Statistics!
        user: User
    }

    type User {
        emailAddress: String
        firstName: String
        lastName: String
        phoneNumber: String
    }

    type QueryResolver {
        findPlayers(displayName: String!, pageNumber: Int): [Player!]!
    }

    schema {
        query: QueryResolver
    }
`;
const schema = buildSchema(destinyGhostSchema);

export default schema;
