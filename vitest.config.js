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
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 82.54,
                branches: 88.99,
                functions: 79.76,
                lines: 82.54,
            },
        },
        exclude: [...defaultExclude, '**/.claude/**'],
        pool: 'threads',
        sequence: {
            hooks: 'parallel',
        },
        testTimeout: 10000, // Set the timeout to 10 seconds
    },
});
