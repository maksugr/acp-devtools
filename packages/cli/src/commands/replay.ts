import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
    type CapturedMessage,
    Session,
    type SessionRecord,
    WsBroadcaster,
    defaultCapturesDbPath,
    openExistingDatabase,
    parseExport,
} from '@acp-devtools/core';

interface ReplayCommandOptions {
    db: string;
    file?: string;
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
            clientVersion: null,
            clientPlatform: null,
            agentName: null,
            agentVersion: null,
            protocolVersion: null,
            currentMode: null,
            currentModel: null,
            agentCapabilitiesJson: null,
        },
        messages: exp.messages,
        label: `imported session #${exp.session.id} from ${path}`,
        cleanup: () => {},
    };
}

function loadFromSqlite(dbPath: string, idArg: string | undefined): LoadedSource {
    const db = openExistingDatabase(dbPath);
    let session: Session;
    try {
        if (idArg !== undefined) {
            const id = Number(idArg);
            if (!Number.isInteger(id) || id <= 0) {
                db.close();
                throw new Error(`invalid id "${idArg}"`);
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
            'Serve a recorded session over WebSocket for replay in the UI. By default replays the latest session in captures.db; pass a session id, or --file to replay a JSON export.',
        )
        .argument('[id]', 'session id to replay (default: latest in the database)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--file <path>', 'replay a JSON export file instead of a saved session')
        .option('--ws-port <port>', 'WebSocket port', '3737')
        .option('--ws-host <host>', 'WebSocket bind address', '127.0.0.1')
        .action(async (idArg: string | undefined, opts: ReplayCommandOptions) => {
            const wsPort = Number(opts.wsPort);
            if (!Number.isInteger(wsPort)) {
                process.stderr.write(`acp-devtools: invalid --ws-port "${opts.wsPort}"\n`);
                process.exit(2);
            }
            if (opts.file !== undefined && idArg !== undefined) {
                process.stderr.write(
                    `acp-devtools: pass either a session id or --file, not both\n`,
                );
                process.exit(2);
            }
            if (idArg !== undefined) {
                const n = Number(idArg);
                if (!Number.isInteger(n) || n <= 0) {
                    process.stderr.write(`acp-devtools: invalid id "${idArg}"\n`);
                    process.exit(2);
                }
            }

            let source: LoadedSource;
            try {
                source =
                    opts.file !== undefined
                        ? loadFromJson(opts.file)
                        : loadFromSqlite(opts.db, idArg);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const what = opts.file ?? opts.db;
                process.stderr.write(`acp-devtools: cannot load ${what}: ${message}\n`);
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
