import type { Command } from 'commander';
import { Session, WsBroadcaster, openDatabase } from '@acp-devtools/core';

interface ReplayCommandOptions {
    session?: string;
    wsPort: string;
    wsHost: string;
}

export function registerReplayCommand(program: Command): void {
    program
        .command('replay')
        .description('Serve a recorded session over WebSocket for replay in the UI')
        .argument('<db>', 'path to a SQLite session database')
        .option('--session <id>', 'session id to replay (default: latest)')
        .option('--ws-port <port>', 'WebSocket port', '3737')
        .option('--ws-host <host>', 'WebSocket bind address', '127.0.0.1')
        .action(async (dbPath: string, opts: ReplayCommandOptions) => {
            const wsPort = Number(opts.wsPort);
            if (!Number.isInteger(wsPort)) {
                process.stderr.write(`acp-devtools: invalid --ws-port "${opts.wsPort}"\n`);
                process.exit(2);
            }

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

            const broadcaster = new WsBroadcaster({ port: wsPort, host: opts.wsHost });
            try {
                const { url } = await broadcaster.start();
                process.stderr.write(
                    `acp-devtools: replaying session #${session.info.id}` +
                        (session.info.name ? ` (${session.info.name})` : '') +
                        ` on ${url}\n`,
                );
                process.stderr.write('acp-devtools: press Ctrl+C to stop\n');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: WS bind failed: ${message}\n`);
                db.close();
                process.exit(1);
            }

            broadcaster.loadHistory(session.info, session.messages());

            await new Promise<void>((resolve) => {
                const stop = () => resolve();
                process.once('SIGINT', stop);
                process.once('SIGTERM', stop);
            });

            await broadcaster.stop();
            db.close();
        });
}
