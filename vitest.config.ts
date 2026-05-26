import { defineConfig } from 'vitest/config';

// Pin TZ before vitest evaluates any test file so timestamp assertions
// (`formatTime`, `formatDateTime`, …) are deterministic across CI / local
// macOS / Linux machines.
process.env.TZ = 'UTC';

export default defineConfig({
    test: {
        // jsdom provides window/document/localStorage for UI store + url-state
        // tests. Core node-only tests (better-sqlite3, ws server) still work
        // because jsdom just layers DOM globals on top of node.
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['packages/*/src/**/*.test.{ts,tsx}'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/index.ts'],
        },
    },
});
