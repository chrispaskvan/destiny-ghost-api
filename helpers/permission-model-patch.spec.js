import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';
import './permission-model-patch.js';

describe('permission-model-patch', () => {
    describe('process.binding("natives")', () => {
        it('should return an object with all builtin module names as keys', () => {
            const result = process.binding('natives');

            for (const mod of builtinModules) {
                expect(result).toHaveProperty(mod);
            }
        });

        it('should map each builtin module to an empty string', () => {
            const result = process.binding('natives');

            for (const mod of builtinModules) {
                expect(result[mod]).toBe('');
            }
        });

        it('should contain the same number of keys as builtinModules', () => {
            const result = process.binding('natives');

            expect(Object.keys(result)).toHaveLength(builtinModules.length);
        });

        it('should include common builtin modules', () => {
            const result = process.binding('natives');

            expect(result).toHaveProperty('fs');
            expect(result).toHaveProperty('path');
            expect(result).toHaveProperty('http');
        });
    });

    describe('process.binding with other names', () => {
        it('should throw an error for non-natives bindings', () => {
            expect(() => process.binding('fs')).toThrow(
                "process.binding('fs') is not supported with the permission model",
            );
        });

        it('should throw an error for arbitrary binding names', () => {
            expect(() => process.binding('http_parser')).toThrow(
                "process.binding('http_parser') is not supported with the permission model",
            );
        });

        it('should include the binding name in the error message', () => {
            const bindingName = 'crypto';

            expect(() => process.binding(bindingName)).toThrow(
                `process.binding('${bindingName}') is not supported with the permission model`,
            );
        });
    });
});
