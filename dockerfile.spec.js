import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The image starts node directly rather than through `pnpm run
 * start:production` (a pnpm start cost 11 seconds on the production plan),
 * so the flags live in two places. The script stays the one the other specs
 * read - the permission grants, for one - so the Dockerfile has to match it.
 */
describe('Dockerfile', () => {
    it('should start node with the same arguments as the start:production script', () => {
        const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
        const [, cmd] = readFileSync('Dockerfile', 'utf8').match(/^CMD (\[.*\])$/m) ?? [];
        const [environment, ...script] = scripts['start:production'].split(' ');

        expect(environment).toBe('NODE_ENV=production');
        expect(JSON.parse(cmd)).toEqual(script);
    });

    it('should set NODE_ENV=production itself, since the script did', () => {
        expect(readFileSync('Dockerfile', 'utf8')).toMatch(/^ENV NODE_ENV=production$/m);
    });
});
