import { describe, expect, it } from 'vitest';
import safeReviver from './safe-reviver.js';

describe('safeReviver', () => {
    it('should parse ordinary JSON unchanged', () => {
        const json = '{"name":"Ghost","stats":{"range":46},"perks":["Outlaw","Kill Clip"]}';

        expect(JSON.parse(json, safeReviver)).toEqual(JSON.parse(json));
    });

    it('should allow constructor as an ordinary value', () => {
        const json = '{"constructor":"Ada-1","details":{"constructor":{"name":"Banshee-44"}}}';

        expect(JSON.parse(json, safeReviver)).toEqual(JSON.parse(json));
    });

    it('should throw on a top-level __proto__ key', () => {
        expect(() => JSON.parse('{"__proto__":{"polluted":true}}', safeReviver)).toThrow(
            SyntaxError,
        );
    });

    it('should throw on a nested __proto__ key', () => {
        expect(() => JSON.parse('{"a":{"b":{"__proto__":{"x":1}}}}', safeReviver)).toThrow(
            SyntaxError,
        );
    });

    it('should throw on a __proto__ key inside an array element', () => {
        expect(() => JSON.parse('[{"__proto__":{"x":1}}]', safeReviver)).toThrow(SyntaxError);
    });

    it('should throw on a constructor key with a prototype property', () => {
        expect(() =>
            JSON.parse('{"constructor":{"prototype":{"polluted":true}}}', safeReviver),
        ).toThrow(SyntaxError);
    });
});
