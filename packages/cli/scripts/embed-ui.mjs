#!/usr/bin/env node
// Copy the built UI bundle (packages/ui/dist) into the CLI's dist tree so
// `acp-devtools ui` can serve a self-contained static frontend without any
// reference to the workspace layout at runtime. Invoked from the root
// `build:full` script after both core/cli and UI have been built.
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', '..', 'ui', 'dist');
const dst = join(__dirname, '..', 'dist', 'ui');

if (!existsSync(src)) {
    process.stderr.write(
        `embed-ui: ${src} not found. Run \`npm run build:ui\` first.\n`,
    );
    process.exit(1);
}
if (!existsSync(join(__dirname, '..', 'dist'))) {
    process.stderr.write(
        `embed-ui: ${join(__dirname, '..', 'dist')} not found. Run \`npm run build\` first.\n`,
    );
    process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });

const files = statSync(dst).isDirectory();
process.stderr.write(
    `embed-ui: copied ${src} → ${dst}${files ? '' : ' (empty?)'}\n`,
);
