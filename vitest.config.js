// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
            statements: 79.45,
            branches: 88.83,
            functions: 70.75,
            lines: 79.45,
            thresholdAutoUpdate: true,
        },
    },
});
