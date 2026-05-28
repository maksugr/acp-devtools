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
    // Native modules and the ACP SDK stay as runtime deps in package.json —
    // bundling them is either impossible (better-sqlite3) or pointless.
    external: ['better-sqlite3', 'ws', 'commander', '@agentclientprotocol/sdk'],
});
