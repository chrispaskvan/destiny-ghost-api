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
/**
 * Factory for the process.binding shim, exported for unit testing.
 *
 * @param {string[]} builtins - List of built-in module names. Defaults to node:module.builtinModules.
 * @returns {(name: string) => any} process.binding-compatible function.
 */
export function createProcessBindingShim(builtins = builtinModules) {
    return function binding(name) {
        if (name === 'natives') {
            return builtins.reduce((natives, mod) => {
                natives[mod] = '';

                return natives;
            }, {});
        }

        throw new Error(`process.binding('${name}') is not supported with the permission model`);
    };
}

process.binding = createProcessBindingShim();
