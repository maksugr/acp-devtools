import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Command } from 'commander';
import {
    defaultCapturesDbPath,
    insertImportedSession,
    parseExport,
} from '@acp-devtools/core';

interface ImportCommandOptions {
    db: string;
    quiet: boolean;
}

export function registerImportCommand(program: Command): void {
    program
        .command('import')
        .description(
            'Insert a JSON session export into captures.db as a new saved session. The new session appears in the inspector picker under its IMPORTED section, with imported_at set to now.',
        )
        .argument('<file>', 'path to a JSON export produced by `acp-devtools export`')
        .option(
            '--db <path>',
            'captures database to write into',
            defaultCapturesDbPath(),
        )
        .option('--quiet', 'suppress the human-readable status line on stderr', false)
        .action((file: string, opts: ImportCommandOptions) => {
            let text: string;
            try {
                text = readFileSync(file, 'utf8');
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot read ${file}: ${msg}\n`);
                process.exit(1);
            }
            try {
                const exp = parseExport(text);
                const result = insertImportedSession(opts.db, exp, {
                    sourceFilename: basename(file),
                });
                if (!opts.quiet) {
                    const noun = result.messageCount === 1 ? 'message' : 'messages';
                    process.stderr.write(
                        `acp-devtools: imported ${file} → session #${result.id} (${result.messageCount} ${noun}) in ${opts.db}\n`,
                    );
                }
                // stdout = just the new id so `id=$(acp-devtools import foo.json)`
                // works for scripts. Stderr carries the human-readable status.
                process.stdout.write(`${result.id}\n`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: import failed: ${msg}\n`);
                process.exit(1);
            }
        });
}
