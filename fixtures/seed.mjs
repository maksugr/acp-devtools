#!/usr/bin/env node
// Generate every demo fixture and import it into the capture database, so the
// sessions show up in the inspector's picker. Backs `npm run fixtures:seed`.
//
// Target database: the default `~/.acp-devtools/captures.db`, or whatever
// `ACP_DEVTOOLS_HOME` points at — set it to a throwaway dir to keep demo data
// out of your real store:
//
//   ACP_DEVTOOLS_HOME=/tmp/acp-dev npm run fixtures:seed
//
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'packages', 'cli', 'dist', 'index.js');

if (!existsSync(cli)) {
    process.stderr.write('seed: CLI not built. Run `npm run build` first.\n');
    process.exit(1);
}

const generators = readdirSync(here)
    .filter((f) => f.startsWith('generate-') && f.endsWith('.mjs'))
    .sort();

const work = mkdtempSync(join(tmpdir(), 'acp-seed-'));
try {
    for (const gen of generators) {
        const out = join(work, gen.replace(/\.mjs$/, '.json'));
        execFileSync('node', [join(here, gen), '--out', out], {
            stdio: ['ignore', 'ignore', 'inherit'],
        });
        execFileSync('node', [cli, 'import', out], { stdio: 'inherit' });
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

process.stderr.write(
    `\nSeeded ${generators.length} fixtures. Open the inspector and pick one:\n` +
        `  acp-devtools ui        (or: npm run dev:ui)\n`,
);
