import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import version from './version.js';

describe('version', () => {
    it("should be package.json's version", () => {
        const { version: expected } = JSON.parse(readFileSync('package.json', 'utf8'));

        expect(version).toBe(expected);
    });
});
