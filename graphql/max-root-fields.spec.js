import { parse, specifiedRules, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import maxRootFields, { MAX_ROOT_FIELDS } from './max-root-fields.js';
import schema from './schema.js';

/**
 * Validated against the real schema with graphql-js's own rules alongside, as
 * graphql-http runs it, so a query the rule lets through is one that would
 * execute and one it stops would not.
 * @param {string} source
 */
const errorsOf = source =>
    validate(schema, parse(source), [...specifiedRules, maxRootFields]).map(
        ({ message }) => message,
    );

const tooMany = expect.stringContaining('top-level field');

describe('maxRootFields', () => {
    it('allows one top-level field', () => {
        expect(MAX_ROOT_FIELDS).toBe(1);
    });

    it('lets a single search through', () => {
        expect(
            errorsOf('{ findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } }'),
        ).toEqual([]);
    });

    it('lets a later page through: paging is an argument, not a field', () => {
        expect(
            errorsOf(
                '{ findPlayers(displayName: "Guardian", pageNumber: 2) { bungieGlobalDisplayName } }',
            ),
        ).toEqual([]);
    });

    it('stops aliases that would run the search twice', () => {
        expect(
            errorsOf(`{
                a: findPlayers(displayName: "Guardian") { bungieGlobalDisplayName }
                b: findPlayers(displayName: "Ghost") { bungieGlobalDisplayName }
            }`),
        ).toEqual([tooMany]);
    });

    it('counts aliases reached through fragments, inline and named', () => {
        expect(
            errorsOf(`
                query { ...one ... on QueryResolver { b: findPlayers(displayName: "Ghost") { bungieGlobalDisplayName } } }
                fragment one on QueryResolver { a: findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } }
            `),
        ).toEqual([tooMany]);
    });

    /** GraphQL merges fields that share a response key, so these run once. */
    it.each([
        [
            'the same field twice',
            '{ findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } findPlayers(displayName: "Guardian") { destinyMemberships { displayName } } }',
        ],
        [
            'the same fragment spread twice',
            `{ ...one ...one }
             fragment one on QueryResolver { findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } }`,
        ],
    ])('lets %s through', (_, source) => {
        expect(errorsOf(source)).toEqual([]);
    });

    it('does not count meta-fields, which call nothing', () => {
        expect(
            errorsOf(
                '{ __typename __schema { queryType { name } } findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } }',
            ),
        ).toEqual([]);
    });

    it('ends on a fragment cycle, which the standard rules report', () => {
        const errors = errorsOf(`
            { ...one }
            fragment one on QueryResolver { ...two }
            fragment two on QueryResolver { ...one }
        `);

        expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('within itself')]));
        expect(errors).not.toContainEqual(tooMany);
    });

    it('judges each operation in a document on its own', () => {
        expect(
            errorsOf(`
                query One { findPlayers(displayName: "Guardian") { bungieGlobalDisplayName } }
                query Two { findPlayers(displayName: "Ghost") { bungieGlobalDisplayName } }
            `),
        ).toEqual([]);
    });
});
