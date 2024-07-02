// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
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
    },
});