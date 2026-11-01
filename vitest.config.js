import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        /**
         * Vitest 5 clears mock call history between tests by default, and the
         * suite leans on it - specs assert `not.toHaveBeenCalled()` on module
         * scoped mocks that earlier tests in the same file did call, and none
         * of them clear explicitly. Pinning it means a version bump or a
         * changed default cannot quietly turn those into false passes.
         */
        clearMocks: true,
        coverage: {
            // Test infrastructure (config, setup, guard rules) is not app code.
            exclude: ['vitest.*.js'],
            reporter: ['clover', 'html', 'json'],
            thresholds: {
                autoUpdate: true,
                statements: 93.49,
                branches: 88.03,
                functions: 93.08,
                lines: 93.55,
            },
        },
        exclude: [...defaultExclude, '**/.claude/**'],
        pool: 'threads',
        // Holds each test file to an allowlist of hosts, and arms nock for
        // integration tests (#783, #784).
        setupFiles: ['./vitest.setup.js'],
        sequence: {
            hooks: 'parallel',
        },
        testTimeout: 10000, // Set the timeout to 10 seconds
    },
});
