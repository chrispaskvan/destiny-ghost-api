import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 79.87,
                branches: 85.38,
                functions: 72.76,
                lines: 79.87,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
    },
});