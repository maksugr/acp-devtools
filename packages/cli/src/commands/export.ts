import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
    Session,
    exportSession,
    openDatabase,
    serializeExport,
} from '@acp-devtools/core';
import { CLI_VERSION } from '../version.js';

interface ExportCommandOptions {
    session?: string;
    output?: string;
    pretty: boolean;
}

export function registerExportCommand(program: Command): void {
    program
        .command('export')
        .description('Export a recorded session as self-contained JSON (suitable for sharing and for mock-replay)')
        .argument('<db>', 'path to a SQLite session database')
        .option('--session <id>', 'session id to export (default: latest)')
        .option('-o, --output <file>', 'write to a file instead of stdout')
        .option('--no-pretty', 'emit compact JSON (no indent, single line)')
        .action((dbPath: string, opts: ExportCommandOptions) => {
            let db;
            try {
                db = openDatabase(dbPath);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot open ${dbPath}: ${message}\n`);
                process.exit(1);
            }

            let session: Session;
            try {
                if (opts.session !== undefined) {
                    const id = Number(opts.session);
                    if (!Number.isInteger(id)) {
                        process.stderr.write(`acp-devtools: invalid --session "${opts.session}"\n`);
                        db.close();
                        process.exit(2);
                    }
                    session = Session.load(db, id);
                } else {
                    session = Session.latest(db);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: ${message}\n`);
                db.close();
                process.exit(1);
            }

            const exp = exportSession(session, {
                tool: { name: 'acp-devtools', version: CLI_VERSION },
            });
            const json = serializeExport(exp, opts.pretty ? 4 : 0);
            db.close();

            if (opts.output) {
                writeFileSync(opts.output, json);
                process.stderr.write(
                    `acp-devtools: exported session #${exp.session.id} (${exp.messages.length} messages) → ${opts.output}\n`,
                );
            } else {
                process.stdout.write(json);
            }
        });
}
