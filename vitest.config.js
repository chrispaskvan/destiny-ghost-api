// eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            reporter: ['clover', 'html'],
        },
    },
});
