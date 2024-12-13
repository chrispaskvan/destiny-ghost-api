import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 78.1,
                branches: 85.12,
                functions: 71.02,
                lines: 78.1,
            },
        },
        sequence: {
            hooks: 'parallel',
        },
    },
});
