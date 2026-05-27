import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import {
    PlaybackEngine,
    Session,
    defaultCapturesDbPath,
    openDatabase,
    parseFrame,
    spawnAgent,
    type CapturedMessage,
    type SqliteDatabase,
} from '@acp-devtools/core';
import { loadPlaybackScript } from './playback-source.js';

interface MockEditorOptions {
    script?: string;
    session?: string;
    db: string;
    cwd?: string;
    log: 'json' | 'pretty' | 'none';
    realtime: boolean;
    saveTo?: string;
    sessionName?: string;
}

export function registerMockEditorCommand(program: Command): void {
    program
        .command('mock-editor')
        .description(
            'Pretend to be an editor by replaying a recorded session script. ' +
                'Spawns the given agent as a child process, sends it the recorded editor-side ' +
                'frames in order, and reads agent responses. Useful for CI tests of your own ' +
                'ACP agent without a real IDE. ' +
                'By default reads from the shared captures.db (latest session); use --session for a specific id or --script for a JSON export from a teammate.',
        )
        .passThroughOptions()
        .argument('<agent>', 'agent executable (e.g. `node fixtures/mock-agent.js` or the path to a real ACP agent)')
        .argument('[agent-args...]', 'arguments forwarded to the agent')
        .option('--session <id>', 'session id from captures.db (default: latest)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--script <file>', 'load from a JSON export instead of the database (mutually exclusive with --session)')
        .option('--cwd <dir>', 'working directory for the agent')
        .option('--log <mode>', 'echo every wire frame to stderr (json | pretty | none)', 'none')
        .option(
            '--realtime',
            'respect the recording\'s timestamps when emitting frames (otherwise replay is instant)',
            false,
        )
        .option(
            '--save-to <file>',
            'persist the mock-editor↔agent conversation to a SQLite database (useful for regression diffing — record a baseline, replay against a new agent version, compare exports)',
        )
        .option('--session-name <name>', 'human-readable label stored with the session')
        .action(async (agent: string, agentArgs: string[], opts: MockEditorOptions) => {
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
            const engine = new PlaybackEngine(loaded.messages, 'editor');
            process.stderr.write(
                `acp-devtools: mock-editor loaded ${loaded.messages.length} frames from ${loaded.source}\n`,
            );

            const spawnOpts: Parameters<typeof spawnAgent>[0] = {
                command: agent,
                args: agentArgs,
            };
            if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
            const child = spawnAgent(spawnOpts);
            process.stderr.write(`acp-devtools: spawned ${agent} (pid ${child.pid})\n`);
            // Forward the agent's stderr so its diagnostics still surface.
            child.stderr.on('data', (chunk) => process.stderr.write(chunk));

            let db: SqliteDatabase | null = null;
            let session: Session | null = null;
            let seqCounter = 0;
            if (opts.saveTo !== undefined) {
                mkdirSync(dirname(opts.saveTo), { recursive: true });
                db = openDatabase(opts.saveTo);
                const startOptions: Parameters<typeof Session.start>[1] = {
                    agentCommand: [agent, ...agentArgs].join(' '),
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

            let stdinClosed = false;
            const closeChildStdin = () => {
                if (stdinClosed) return;
                stdinClosed = true;
                child.stdin.end();
            };

            // See mock-agent.ts — same timer-chain pattern for --realtime.
            let pendingTimer: ReturnType<typeof setTimeout> | null = null;

            const emit = (line: string) => {
                child.stdin.write(line + '\n');
                log('→', line);
                capture(line, 'editor-to-agent');
            };

            const drain = () => {
                if (pendingTimer) return;
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
                        // Script done — close the agent's stdin so it knows
                        // no more input is coming. Then wait for it to exit.
                        closeChildStdin();
                        return;
                    }
                    return; // wait for agent's stdout
                }
            };

            let buf = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                buf += chunk;
                let idx: number;
                while ((idx = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (!line) continue;
                    log('←', line);
                    capture(line, 'agent-to-editor');
                    engine.onIncoming(line);
                    drain();
                }
            });

            const forwardSignal = (sig: NodeJS.Signals) => {
                process.on(sig, () => child.kill(sig));
            };
            forwardSignal('SIGINT');
            forwardSignal('SIGTERM');

            // Emit leading editor frames before waiting for the agent.
            drain();

            const { code, signal } = await child.exited;
            if (!engine.exhausted) {
                process.stderr.write(
                    `acp-devtools: warning — agent exited with ${loaded.messages.length - engine.position} script frames unplayed\n`,
                );
            }
            closeSession();
            if (signal) {
                process.kill(process.pid, signal);
            } else {
                process.exit(code ?? 0);
            }
        });
}
