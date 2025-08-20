import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 81.92,
                branches: 88.37,
                functions: 79.68,
                lines: 81.92,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
        testTimeout: 10000, // Set the timeout to 10 seconds
    },
});