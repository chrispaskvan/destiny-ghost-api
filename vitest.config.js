import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 82.38,
                branches: 88.96,
                functions: 80.31,
                lines: 82.38,
            },
        },
        pool: 'threads',
        sequence: {
            hooks: 'parallel',
        },
        testTimeout: 10000, // Set the timeout to 10 seconds
    },
});