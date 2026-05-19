import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['packages/*/src/**/*.test.ts'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/index.ts'],
        },
    },
});
