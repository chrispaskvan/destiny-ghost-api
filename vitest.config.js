import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 80.9,
                branches: 86.94,
                functions: 72.98,
                lines: 80.9,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
    },
});