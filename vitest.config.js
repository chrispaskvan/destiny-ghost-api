// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 77.5,
                branches: 87.31,
                functions: 69.51,
                lines: 77.5,
            },
        },
    },
});