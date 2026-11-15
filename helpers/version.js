// @ts-check
/**
 * The package version, from package.json itself rather than
 * `npm_package_version`: production starts `node` directly (see the
 * Dockerfile's CMD), and only a package manager running a script sets that
 * variable.
 *
 * @module version
 */
import { readFileSync } from 'node:fs';

/** @type {{ version: string }} */
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default version;
