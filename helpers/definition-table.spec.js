import { describe, expect, it } from 'vitest';
import DefinitionTable from './definition-table.js';

const definitions = [
    { hash: 3, displayProperties: { name: 'Night Watch' } },
    { hash: 1, displayProperties: { name: 'Ace of Spades' } },
    { hash: 2, displayProperties: { name: 'Thorn' } },
];
const rowsOf = items => items.map(item => ({ hash: item.hash, json: JSON.stringify(item) }));

describe('DefinitionTable', () => {
    it('should count every row', () => {
        expect(new DefinitionTable(rowsOf(definitions)).length).toEqual(3);
    });

    it('should parse a definition on first read and return the same object after', () => {
        const table = new DefinitionTable(rowsOf(definitions));
        const thorn = table.get(2);

        expect(thorn).toEqual(definitions[2]);
        expect(table.get(2)).toBe(thorn);
    });

    it('should return undefined for a hash it does not hold', () => {
        expect(new DefinitionTable(rowsOf(definitions)).get(4)).toBeUndefined();
    });

    it('should slice and iterate in table order', () => {
        const table = new DefinitionTable(rowsOf(definitions));

        expect(table.slice(1, 3)).toEqual(definitions.slice(1, 3));
        expect([...table.entries()]).toEqual([...definitions.entries()]);
    });

    /**
     * The last row is not JSON, so reading it would throw: iterating stops
     * short of it without ever parsing it.
     */
    it('should parse only the definitions it is asked for', () => {
        const table = new DefinitionTable([...rowsOf(definitions), { hash: 4, json: '{' }]);
        const entries = table.entries();

        expect(entries.next().value).toEqual([0, definitions[0]]);
        expect(table.slice(0, 3)).toEqual(definitions);
        expect(() => table.get(4)).toThrow(SyntaxError);
    });
});
