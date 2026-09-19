import { graphql } from 'graphql';
import { describe, expect, it } from 'vitest';
import schema from './schema.js';

/**
 * The resolver hands back Bungie's display values, so these fields carry
 * whatever Bungie chose to print - already rounded, and in the case of large
 * numbers possibly carrying a separator. Declaring them numeric put GraphQL in
 * the way of that: it coerced the ordinary values on the way out and failed the
 * field outright on a formatted one.
 *
 * Executing the schema is the only place that shows up. root.spec.js exercises
 * the resolver against mocked services and never serializes, so it agrees with
 * either declaration.
 */
const statistics = {
    combatRating: '142.5',
    efficiency: '1.23',
    highestLightLevel: '1,810',
    kda: '1.55',
    kdr: '1.42',
};
const source = `{
    findPlayers(displayName: "Guardian") {
        statistics {
            pvp {
                combatRating
                efficiency
                highestLightLevel
                kda
                kdr
            }
        }
    }
}`;

describe('schema', () => {
    describe('PvPStatistics', () => {
        it('should declare every statistic as a String', async () => {
            const { data } = await graphql({
                schema,
                source: '{ __type(name: "PvPStatistics") { fields { name type { name } } } }',
            });
            const declared = Object.fromEntries(
                data.__type.fields.map(({ name, type }) => [name, type.name]),
            );

            expect(declared).toEqual({
                combatRating: 'String',
                efficiency: 'String',
                highestLightLevel: 'String',
                kda: 'String',
                kdr: 'String',
            });
        });

        it('should return a display value carrying a separator rather than failing on it', async () => {
            const { data, errors } = await graphql({
                schema,
                source,
                rootValue: { findPlayers: () => [{ statistics: { pvp: statistics } }] },
            });

            expect(errors).toBeUndefined();
            expect(data.findPlayers[0].statistics.pvp).toEqual(statistics);
        });
    });
});
