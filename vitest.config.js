// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            statements: 78.95,
            branches: 88.83,
            functions: 69.84,
            lines: 78.95,
            thresholdAutoUpdate: true,
        },
    },
});
