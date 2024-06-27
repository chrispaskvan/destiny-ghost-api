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

    type PvPStatistics {
        combatRating: Float
        efficiency: Float
        highestLightLevel: Int
        kda: Float
        kdr: Float
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
