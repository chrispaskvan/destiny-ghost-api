// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            statements: 79.31,
            branches: 88.35,
            functions: 70.7,
            lines: 79.31,
            thresholdAutoUpdate: true,
        },
    },
});
