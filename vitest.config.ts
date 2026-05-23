import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // jsdom provides window/document/localStorage for UI store + url-state
        // tests. Core node-only tests (better-sqlite3, ws server) still work
        // because jsdom just layers DOM globals on top of node.
        environment: 'jsdom',
        include: ['packages/*/src/**/*.test.ts'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/index.ts'],
        },
    },
});
