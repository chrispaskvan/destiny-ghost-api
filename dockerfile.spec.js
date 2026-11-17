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

    /**
     * `COPY . .` puts everything .dockerignore does not name into the image,
     * and what git ignores is mostly what must not ship: the development TLS
     * key in security/ and the API client collections in .bruno/ were both
     * in pushed images. So anything git ignores has to be ignored here too,
     * unless it is named below as something production reads.
     */
    it('should keep everything git ignores out of the image, settings aside', () => {
        // config.js reads settings/ as it loads, so the image carries it for now
        const shipped = ['settings'];
        /** @param {string} file */
        const entries = file =>
            readFileSync(file, 'utf8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
                .map(line => line.replace(/\/\*?$/, '').toLowerCase());
        const excluded = entries('.dockerignore');
        const leaked = entries('.gitignore').filter(
            entry => !shipped.includes(entry) && !excluded.includes(entry),
        );

        expect(leaked).toEqual([]);
    });
});
