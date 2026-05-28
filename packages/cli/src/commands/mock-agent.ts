import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import {
    PlaybackEngine,
    Session,
    defaultCapturesDbPath,
    openDatabase,
    parseFrame,
    type CapturedMessage,
    type SqliteDatabase,
} from '@acp-devtools/core';
import { loadPlaybackScript } from './playback-source.js';

interface MockAgentOptions {
    script?: string;
    session?: string;
    db: string;
    log: 'json' | 'pretty' | 'none';
    realtime: boolean;
    saveTo?: string;
    sessionName?: string;
}

export function registerMockAgentCommand(program: Command): void {
    program
        .command('mock-agent')
        .description(
            'Pretend to be an ACP agent by replaying a recorded session script. ' +
                'Reads JSON-RPC from stdin (real editor), writes recorded responses to stdout. ' +
                'Wire it into an IDE `agent_servers` config to drive plugin tests without a live LLM. ' +
                'By default reads from the shared captures database (latest session); use --session for a specific id or --script for a JSON export from a teammate.',
        )
        .option('--session <id>', 'session id from the captures database (default: latest)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--script <file>', 'load from a JSON export instead of the database (mutually exclusive with --session)')
        .option('--log <mode>', 'echo every wire frame to stderr (json | pretty | none)', 'none')
        .option(
            '--realtime',
            'respect the recording\'s timestamps when emitting frames (otherwise replay is instant)',
            false,
        )
        .option(
            '--save-to <file>',
            'persist the editor↔mock conversation to a SQLite database (visible in `acp-devtools list` afterwards)',
        )
        .option('--session-name <name>', 'human-readable label stored with the session')
        .action((opts: MockAgentOptions) => {
            if (!['json', 'pretty', 'none'].includes(opts.log)) {
                process.stderr.write(`acp-devtools: invalid --log "${opts.log}"\n`);
                process.exit(2);
            }
            let loaded;
            try {
                loaded = loadPlaybackScript(opts);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: ${msg}\n`);
                process.exit(1);
            }
            const engine = new PlaybackEngine(loaded.messages, 'agent');
            process.stderr.write(
                `acp-devtools: mock-agent loaded ${loaded.messages.length} frames from ${loaded.source}\n`,
            );

            let db: SqliteDatabase | null = null;
            let session: Session | null = null;
            let seqCounter = 0;
            if (opts.saveTo !== undefined) {
                mkdirSync(dirname(opts.saveTo), { recursive: true });
                db = openDatabase(opts.saveTo);
                const startOptions: Parameters<typeof Session.start>[1] = {
                    agentCommand: `mock-agent · ${loaded.source}`,
                };
                if (opts.sessionName) startOptions.name = opts.sessionName;
                session = Session.start(db, startOptions);
                process.stderr.write(
                    `acp-devtools: saving to ${opts.saveTo} (session #${session.info.id})\n`,
                );
            }
            const capture = (line: string, direction: CapturedMessage['direction']) => {
                if (!session) return;
                seqCounter += 1;
                const frame = parseFrame(line);
                const msg: CapturedMessage = {
                    seq: seqCounter,
                    timestamp: Date.now(),
                    direction,
                    kind: frame.kind,
                    raw: frame.raw,
                    payload: frame.payload,
                };
                if (frame.method !== undefined) msg.method = frame.method;
                if (frame.rpcId !== undefined) msg.rpcId = frame.rpcId;
                if (frame.parseError !== undefined) msg.parseError = frame.parseError;
                session.record(msg);
            };
            const closeSession = () => {
                if (session) {
                    session.close();
                    session = null;
                }
                if (db) {
                    db.close();
                    db = null;
                }
            };
            process.on('exit', closeSession);

            const log = (dir: '→' | '←', line: string) => {
                if (opts.log === 'json') {
                    process.stderr.write(JSON.stringify({ dir, line }) + '\n');
                } else if (opts.log === 'pretty') {
                    process.stderr.write(`${dir} ${line}\n`);
                }
            };

            // When --realtime is set we chain timers so the playback honours
            // the recording's wall-clock pacing. `pendingTimer` guards against
            // re-entrance: stdin events arriving mid-wait advance the engine
            // state via onIncoming, but emit is already scheduled and the
            // captured `step.line` is what gets written when the timer fires.
            let pendingTimer: ReturnType<typeof setTimeout> | null = null;

            const emit = (line: string) => {
                process.stdout.write(line + '\n');
                log('←', line);
                capture(line, 'agent-to-editor');
            };

            const drain = () => {
                if (pendingTimer) return; // an emit is already queued
                while (true) {
                    const step = engine.next();
                    if (step.kind === 'emit') {
                        const delay = opts.realtime ? step.deltaSincePrevMs : 0;
                        if (delay > 0) {
                            const line = step.line;
                            pendingTimer = setTimeout(() => {
                                pendingTimer = null;
                                emit(line);
                                drain();
                            }, delay);
                            return;
                        }
                        emit(step.line);
                        continue;
                    }
                    if (step.kind === 'done') {
                        // Script exhausted — keep consuming any further editor
                        // input silently so the IDE doesn't get a pipe error.
                        return;
                    }
                    return; // wait
                }
            };

            let buf = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => {
                buf += chunk;
                let idx: number;
                while ((idx = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (!line) continue;
                    log('→', line);
                    capture(line, 'editor-to-agent');
                    engine.onIncoming(line);
                    drain();
                }
            });
            process.stdin.on('end', () => {
                drain();
                closeSession();
                process.exit(0);
            });

            // Some scripts have notifications at the very start (no waiting).
            drain();
        });
}
