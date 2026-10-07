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
            reporter: ['clover', 'html', 'json'],
            thresholds: {
                autoUpdate: true,
                statements: 91.5,
                branches: 85.84,
                functions: 89.94,
                lines: 91.55,
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
