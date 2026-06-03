import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
    Session,
    defaultCapturesDbPath,
    exportSession,
    openExistingDatabase,
    redactSessionExport,
    serializeExport,
} from '@acp-devtools/core';
import { CLI_VERSION } from '../version.js';

interface ExportCommandOptions {
    db: string;
    output?: string;
    pretty: boolean;
    raw: boolean;
}

export function registerExportCommand(program: Command): void {
    program
        .command('export')
        .description('Export a recorded session as self-contained JSON (suitable for sharing and for mock-replay)')
        .argument('[id]', 'session id to export (default: latest in the database)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('-o, --output <file>', 'write to a file instead of stdout')
        .option('--no-pretty', 'emit compact JSON (no indent, single line)')
        .option(
            '--raw',
            'skip default redaction of auth headers / proxy tokens (use only when the export stays on YOUR machine)',
            false,
        )
        .action((idArg: string | undefined, opts: ExportCommandOptions) => {
            let id: number | null = null;
            if (idArg !== undefined) {
                id = Number(idArg);
                if (!Number.isInteger(id) || id <= 0) {
                    process.stderr.write(`acp-devtools: invalid id "${idArg}"\n`);
                    process.exit(2);
                }
            }

            let db;
            try {
                db = openExistingDatabase(opts.db);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot open ${opts.db}: ${message}\n`);
                process.exit(1);
            }

            let session: Session;
            try {
                session = id !== null ? Session.load(db, id) : Session.latest(db);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: ${message}\n`);
                db.close();
                process.exit(1);
            }

            const rawExp = exportSession(session, {
                tool: { name: 'acp-devtools', version: CLI_VERSION },
            });
            const { export: finalExp, fieldsRedacted, messagesAffected } = opts.raw
                ? { export: rawExp, fieldsRedacted: 0, messagesAffected: 0 }
                : redactSessionExport(rawExp);
            const json = serializeExport(finalExp, opts.pretty ? 4 : 0);
            db.close();

            if (opts.output) {
                writeFileSync(opts.output, json);
                process.stderr.write(
                    `acp-devtools: exported session #${finalExp.session.id} (${finalExp.messages.length} messages) → ${opts.output}\n`,
                );
            } else {
                process.stdout.write(json);
            }

            if (opts.raw) {
                process.stderr.write(
                    'acp-devtools: --raw was set; export may contain auth headers / proxy tokens — do not share publicly\n',
                );
            } else if (fieldsRedacted > 0) {
                process.stderr.write(
                    `acp-devtools: redacted ${fieldsRedacted} field(s) across ${messagesAffected} message(s) — re-run with --raw to keep them\n`,
                );
            }
        });
}
