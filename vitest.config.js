// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            thresholds: {
                autoUpdate: true,
                statements: 76.85,
                branches: 87.31,
                functions: 68.8,
                lines: 76.85,
            },
        },
    },
});
