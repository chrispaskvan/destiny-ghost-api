/**
 * Shim for process.binding("natives") blocked by the Node.js Permission Model.
 *
 * The `diagnostic-channel` package (used by `applicationinsights`) calls
 * `process.binding("natives")` to discover built-in modules. This deprecated
 * API is blocked when --permission is active.
 *
 * This preload script replaces process.binding with a targeted shim that
 * returns built-in module names via the supported `module.builtinModules` API.
 * All other process.binding calls remain blocked.
 *
 * @see https://nodejs.org/api/permissions.html
 * @see https://nodejs.org/api/module.html#modulebuiltinmodules
 */
import { builtinModules } from 'node:module';

process.binding = function binding(name) {
    if (name === 'natives') {
        if (Array.isArray(builtinModules)) {
            return builtinModules.reduce((natives, mod) => {
                natives[mod] = '';

                return natives;
            }, {});
        }

        // Fallback: if builtinModules is unavailable or not an array, return an empty object
        return {};
    }

    throw new Error(`process.binding('${name}') is not supported with the permission model`);
};
