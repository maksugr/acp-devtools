import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
    type CapturedMessage,
    Session,
    type SessionRecord,
    WsBroadcaster,
    openDatabase,
    parseExport,
} from '@acp-devtools/core';

interface ReplayCommandOptions {
    session?: string;
    wsPort: string;
    wsHost: string;
}

interface LoadedSource {
    info: SessionRecord;
    messages: Iterable<CapturedMessage>;
    label: string;
    cleanup: () => void;
}

function loadFromJson(path: string): LoadedSource {
    const text = readFileSync(path, 'utf8');
    const exp = parseExport(text);
    return {
        info: {
            id: exp.session.id,
            name: exp.session.name,
            agentCommand: exp.session.agentCommand,
            startedAt: exp.session.startedAt,
            endedAt: exp.session.endedAt,
            clientName: exp.session.clientName,
            importedAt: null,
        },
        messages: exp.messages,
        label: `imported session #${exp.session.id} from ${path}`,
        cleanup: () => {},
    };
}

function loadFromSqlite(path: string, sessionOpt: string | undefined): LoadedSource {
    const db = openDatabase(path);
    let session: Session;
    try {
        if (sessionOpt !== undefined) {
            const id = Number(sessionOpt);
            if (!Number.isInteger(id)) {
                db.close();
                throw new Error(`invalid --session "${sessionOpt}"`);
            }
            session = Session.load(db, id);
        } else {
            session = Session.latest(db);
        }
    } catch (err) {
        db.close();
        throw err;
    }
    return {
        info: session.info,
        messages: session.messages(),
        label:
            `replaying session #${session.info.id}` +
            (session.info.name ? ` (${session.info.name})` : ''),
        cleanup: () => db.close(),
    };
}

export function registerReplayCommand(program: Command): void {
    program
        .command('replay')
        .description(
            'Serve a recorded session over WebSocket for replay in the UI. Accepts a SQLite database or a JSON export (auto-detected by extension).',
        )
        .argument('<path>', 'path to a SQLite session database or a `.json` export file')
        .option('--session <id>', 'session id to replay (SQLite only; default: latest)')
        .option('--ws-port <port>', 'WebSocket port', '3737')
        .option('--ws-host <host>', 'WebSocket bind address', '127.0.0.1')
        .action(async (path: string, opts: ReplayCommandOptions) => {
            const wsPort = Number(opts.wsPort);
            if (!Number.isInteger(wsPort)) {
                process.stderr.write(`acp-devtools: invalid --ws-port "${opts.wsPort}"\n`);
                process.exit(2);
            }

            const isJson = path.toLowerCase().endsWith('.json');
            if (isJson && opts.session !== undefined) {
                process.stderr.write(
                    `acp-devtools: --session is only meaningful for SQLite databases; a JSON export already contains a single session\n`,
                );
                process.exit(2);
            }

            let source: LoadedSource;
            try {
                source = isJson ? loadFromJson(path) : loadFromSqlite(path, opts.session);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot load ${path}: ${message}\n`);
                process.exit(1);
            }

            const broadcaster = new WsBroadcaster({ port: wsPort, host: opts.wsHost });
            try {
                const { url } = await broadcaster.start();
                process.stderr.write(`acp-devtools: ${source.label} on ${url}\n`);
                process.stderr.write('acp-devtools: press Ctrl+C to stop\n');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: WS bind failed: ${message}\n`);
                source.cleanup();
                process.exit(1);
            }

            broadcaster.loadHistory(source.info, source.messages);

            await new Promise<void>((resolve) => {
                const stop = () => resolve();
                process.once('SIGINT', stop);
                process.once('SIGTERM', stop);
            });

            await broadcaster.stop();
            source.cleanup();
        });
}
