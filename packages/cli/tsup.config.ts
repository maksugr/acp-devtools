import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    dts: false,
    splitting: false,
    shims: false,
    // Inline @acp-devtools/core so the published CLI is self-contained and
    // never asks npm for an internal workspace package at install time.
    noExternal: ['@acp-devtools/core'],
    // Native and large runtime deps stay in package.json — bundling them is
    // either impossible (better-sqlite3) or pointless. The ACP JSON schemas
    // are bundled (imported from @agentclientprotocol/sdk at build time), so
    // the SDK is not a runtime dependency.
    external: ['better-sqlite3', 'ws', 'commander'],
});
