// @ts-check
/**
 * A validation rule holding each operation to one top-level field.
 *
 * `/director` is a demonstration of GraphQL, not yet for general use, and its
 * one query, `findPlayers`, is a Bungie search plus a statistics lookup for
 * every player found. Aliases (`a: findPlayers(…) b: findPlayers(…)`) would
 * run that once per alias in a single request, charged once by any limit that
 * counts requests, and paging is already an argument, so a real search never
 * needs a second field.
 */
import { GraphQLError, Kind } from 'graphql';

/** Top-level fields one operation may ask for. */
const MAX_ROOT_FIELDS = 1;

/**
 * The response keys an operation's top level runs, through fragments.
 *
 * Counted by response key - the alias, or the name without one - because
 * GraphQL merges fields that share one: `findPlayers` asked for twice, or a
 * fragment spread twice, runs once. Only an alias adds a run. Meta-fields
 * (`__typename`, `__schema`, `__type`) call nothing, so they don't count.
 * @param {import('graphql').SelectionSetNode} selectionSet
 * @param {import('graphql').ValidationContext} context
 * @param {Set<string>} keys - collected into
 * @param {Set<string>} visited - fragments already expanded; cycles are
 * reported by `NoFragmentCyclesRule`, so here they only need to end
 * @returns {Set<string>}
 */
const collectRootKeys = (selectionSet, context, keys = new Set(), visited = new Set()) => {
    for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
            if (!selection.name.value.startsWith('__')) {
                keys.add(selection.alias?.value ?? selection.name.value);
            }
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
            collectRootKeys(selection.selectionSet, context, keys, visited);
        } else if (!visited.has(selection.name.value)) {
            visited.add(selection.name.value);

            const fragment = context.getFragment(selection.name.value);

            if (fragment) {
                collectRootKeys(fragment.selectionSet, context, keys, visited);
            }
        }
    }

    return keys;
};

/**
 * @param {import('graphql').ValidationContext} context
 * @returns {import('graphql').ASTVisitor}
 */
const maxRootFields = context => ({
    OperationDefinition(operation) {
        const { size } = collectRootKeys(operation.selectionSet, context);

        if (size > MAX_ROOT_FIELDS) {
            context.reportError(
                new GraphQLError(
                    `An operation may ask for ${MAX_ROOT_FIELDS} top-level field; this one asks for ${size}.`,
                    { nodes: operation },
                ),
            );
        }
    },
});

export default maxRootFields;
export { MAX_ROOT_FIELDS };
