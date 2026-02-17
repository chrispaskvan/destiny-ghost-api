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
 * SCOPE AND SECURITY TRADEOFFS:
 * 
 * 1. Minimal Functionality: This shim ONLY provides the functionality needed by
 *    diagnostic-channel to discover built-in module names. It returns an object
 *    mapping module names to empty strings, which satisfies the diagnostic-channel
 *    requirement without exposing actual module internals.
 * 
 * 2. Security Preservation: All other process.binding() calls (e.g., 'fs', 'http_parser',
 *    'crypto') will throw errors as expected under the permission model. This maintains
 *    the security boundaries that the permission model enforces.
 * 
 * 3. Dependency Criticality: applicationinsights provides telemetry and monitoring
 *    capabilities but is NOT critical for core application functionality. If this shim
 *    fails or applicationinsights cannot load, the application will continue to operate
 *    normally, but without telemetry collection. Operations teams should monitor for
 *    telemetry gaps if this shim encounters issues.
 *
 * @see https://nodejs.org/api/permissions.html
 * @see https://nodejs.org/api/module.html#modulebuiltinmodules
 */
import { builtinModules } from 'node:module';

process.binding = function binding(name) {
    if (name === 'natives') {
        return builtinModules.reduce((natives, mod) => {
            natives[mod] = '';

            return natives;
        }, {});
    }

    throw new Error(`process.binding('${name}') is not supported with the permission model`);
};
