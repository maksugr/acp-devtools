#!/usr/bin/env node
// Sanity check before `npm publish`: confirms the dist tree has both the
// bundled CLI and the embedded UI. Run as `prepublishOnly` so a stale
// build cannot accidentally ship.
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, '..');

const REQUIRED = [
    'dist/index.js',
    'dist/ui/index.html',
];

const missing = [];
for (const rel of REQUIRED) {
    const abs = join(cliRoot, rel);
    if (!existsSync(abs)) {
        missing.push(rel);
        continue;
    }
    if (statSync(abs).size === 0) {
        missing.push(`${rel} (empty)`);
    }
}

if (missing.length > 0) {
    process.stderr.write(`prepublishOnly: build artifacts missing:\n`);
    for (const m of missing) process.stderr.write(`  - ${m}\n`);
    process.stderr.write(
        `\nRun \`npm run build:full\` from the monorepo root before publishing.\n`,
    );
    process.exit(1);
}

process.stderr.write('prepublishOnly: dist tree OK\n');
