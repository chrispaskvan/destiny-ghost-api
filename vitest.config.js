import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 78.12,
                branches: 87.38,
                functions: 71.19,
                lines: 78.12,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
    },
});
