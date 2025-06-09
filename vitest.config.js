import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 80.9,
                branches: 87.4,
                functions: 76.58,
                lines: 80.9,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
        testTimeout: 10000, // Set the timeout to 10 seconds
    },
});