import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 79.47,
                branches: 85.3,
                functions: 72.24,
                lines: 79.47,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
    },
});