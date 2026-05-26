import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import {
    AcpProxy,
    type ActiveCapture,
    type CapturedMessage,
    type SessionRecord,
    Session,
    WsBroadcaster,
    defaultCapturesDbPath,
    listAgents,
    openDatabase,
    removeActiveFile,
    resolveAgent,
    writeActiveFile,
} from '@acp-devtools/core';

interface ProxyCommandOptions {
    log: 'json' | 'pretty' | 'none';
    cwd?: string;
    saveTo?: string;
    save: boolean;
    sessionName?: string;
    wsPort: string;
    wsHost: string;
    ws: boolean;
    agent?: string;
}

const DIRECTION_LABEL: Record<CapturedMessage['direction'], string> = {
    'editor-to-agent': '→ AGENT',
    'agent-to-editor': '← AGENT',
};

function formatPretty(msg: CapturedMessage): string {
    const time = new Date(msg.timestamp).toISOString().slice(11, 23);
    const dir = DIRECTION_LABEL[msg.direction];
    const head = `[${time}] ${dir} ${msg.kind}${msg.method ? ' ' + msg.method : ''}`;
    const id = msg.rpcId !== undefined ? ` id=${String(msg.rpcId)}` : '';
    const err = msg.parseError ? ` parseError=${msg.parseError}` : '';
    return `${head}${id}${err}\n  ${msg.raw}`;
}

export function registerProxyCommand(program: Command): void {
    const knownAgentList = listAgents()
        .map((a) => a.shortName)
        .join(', ');
    program
        .command('proxy')
        .description('Run an ACP agent through a capturing proxy')
        .passThroughOptions()
        .argument('[agent]', 'agent executable (e.g. "goose"); optional when --agent is set')
        .argument('[agent-args...]', 'arguments forwarded to the agent')
        .option(
            '--agent <name>',
            `preset for a known ACP agent (${knownAgentList})`,
        )
        .option('--log <mode>', 'message log format: json | pretty | none', 'none')
        .option('--cwd <dir>', 'working directory for the agent')
        .option(
            '--save-to <file>',
            'persist the session to a SQLite database (default: auto-generated path under ~/.acp-devtools/sessions/)',
        )
        .option('--no-save', 'disable session persistence entirely (no SQLite file)')
        .option('--session-name <name>', 'human-readable label stored with the session')
        .option(
            '--ws-port <port>',
            'WebSocket port for live streaming (0 = ephemeral, the default; UI discovers via ~/.acp-devtools/active/)',
            '0',
        )
        .option('--ws-host <host>', 'WebSocket bind address', '127.0.0.1')
        .option('--no-ws', 'disable the WebSocket server')
        .action(async (agentArg: string | undefined, agentArgsArg: string[], opts: ProxyCommandOptions) => {
            let agent: string;
            let agentArgs: string[];
            if (opts.agent) {
                try {
                    const def = resolveAgent(opts.agent);
                    agent = def.command;
                    agentArgs = [...def.args];
                    if (agentArg !== undefined) {
                        agentArgs.push(agentArg, ...agentArgsArg);
                    }
                } catch (err) {
                    process.stderr.write(
                        `acp-devtools: ${err instanceof Error ? err.message : String(err)}\n`,
                    );
                    process.exit(2);
                    return;
                }
            } else if (agentArg !== undefined) {
                agent = agentArg;
                agentArgs = agentArgsArg;
            } else {
                process.stderr.write(
                    `acp-devtools: no agent specified.\n` +
                        `  Pass an agent command (\`acp-devtools proxy npx -y @zed-industries/claude-code-acp\`)\n` +
                        `  or use --agent <name> with one of: ${knownAgentList}.\n`,
                );
                process.exit(2);
                return;
            }
            if (!['json', 'pretty', 'none'].includes(opts.log)) {
                process.stderr.write(`acp-devtools: invalid --log value "${opts.log}"\n`);
                process.exit(2);
            }
            const wsPort = Number(opts.wsPort);
            if (opts.ws && !Number.isInteger(wsPort)) {
                process.stderr.write(`acp-devtools: invalid --ws-port "${opts.wsPort}"\n`);
                process.exit(2);
            }

            let broadcaster: WsBroadcaster | null = null;
            let boundPort = wsPort;
            let boundUrl: string | null = null;
            if (opts.ws) {
                broadcaster = new WsBroadcaster({ port: wsPort, host: opts.wsHost });
                try {
                    const info = await broadcaster.start();
                    boundPort = info.port;
                    boundUrl = info.url;
                    process.stderr.write(`acp-devtools: WebSocket listening on ${info.url}\n`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    process.stderr.write(`acp-devtools: WS bind failed: ${message}\n`);
                    process.exit(1);
                }
            }

            let session: Session | null = null;
            let resolvedSaveTo: string | null = null;
            if (opts.save) {
                resolvedSaveTo = opts.saveTo ?? defaultCapturesDbPath();
                mkdirSync(dirname(resolvedSaveTo), { recursive: true });
                const db = openDatabase(resolvedSaveTo);
                const startOptions: Parameters<typeof Session.start>[1] = {
                    agentCommand: [agent, ...agentArgs].join(' '),
                };
                if (opts.sessionName) startOptions.name = opts.sessionName;
                session = Session.start(db, startOptions);
                process.stderr.write(
                    `acp-devtools: saving to ${resolvedSaveTo} (session #${session.info.id})\n`,
                );
            }

            const sessionInfo: SessionRecord = session
                ? session.info
                : {
                      id: 0,
                      name: opts.sessionName ?? null,
                      agentCommand: [agent, ...agentArgs].join(' '),
                      startedAt: Date.now(),
                      endedAt: null,
                      clientName: null,
                  };
            broadcaster?.publishSessionStart(sessionInfo);

            // Publish discovery descriptor so the UI can attach without
            // hard-coding a port. Best-effort cleanup on every exit path.
            let discoveryWritten = false;
            let discoveryRecord: ActiveCapture | null = null;
            if (broadcaster && boundUrl !== null) {
                discoveryRecord = {
                    version: 1,
                    pid: process.pid,
                    host: opts.wsHost,
                    port: boundPort,
                    url: boundUrl,
                    agentCommand: [agent, ...agentArgs].join(' '),
                    sessionName: opts.sessionName ?? null,
                    sessionDbId: session?.info.id ?? null,
                    saveTo: resolvedSaveTo,
                    startedAt: sessionInfo.startedAt,
                    clientName: null,
                };
                try {
                    writeActiveFile(discoveryRecord);
                    discoveryWritten = true;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    process.stderr.write(`acp-devtools: discovery write failed: ${message}\n`);
                }
            }
            const cleanupDiscovery = () => {
                if (discoveryWritten) {
                    discoveryWritten = false;
                    removeActiveFile(process.pid);
                }
            };
            process.on('exit', cleanupDiscovery);

            const proxyOptions: ConstructorParameters<typeof AcpProxy>[0] = {
                command: agent,
                args: agentArgs,
            };
            if (opts.cwd !== undefined) proxyOptions.cwd = opts.cwd;
            const proxy = new AcpProxy(proxyOptions);

            proxy.on('started', ({ pid }) => {
                process.stderr.write(`acp-devtools: spawned ${agent} (pid ${pid})\n`);
            });

            let clientDetected = false;
            const detectClient = (msg: CapturedMessage) => {
                if (clientDetected) return;
                if (msg.direction !== 'editor-to-agent' || msg.method !== 'initialize') return;
                const payload = msg.payload as { params?: { clientInfo?: { title?: unknown; name?: unknown } } } | null;
                const info = payload?.params?.clientInfo;
                const title = typeof info?.title === 'string' ? info.title : null;
                const name = typeof info?.name === 'string' ? info.name : null;
                const clientName = title ?? name;
                if (!clientName) return;
                clientDetected = true;
                session?.setClientName(clientName);
                if (discoveryWritten && discoveryRecord) {
                    discoveryRecord = { ...discoveryRecord, clientName };
                    try {
                        writeActiveFile(discoveryRecord);
                    } catch {
                        // best-effort; UI will keep the placeholder label
                    }
                }
            };

            proxy.on('message', (msg) => {
                if (opts.log === 'json') {
                    process.stderr.write(JSON.stringify(msg) + '\n');
                } else if (opts.log === 'pretty') {
                    process.stderr.write(formatPretty(msg) + '\n');
                }
                session?.record(msg);
                broadcaster?.publishMessage(msg);
                detectClient(msg);
            });

            proxy.on('error', (err) => {
                process.stderr.write(`acp-devtools: ${err.message}\n`);
            });

            const forwardSignal = (sig: NodeJS.Signals) => {
                process.on(sig, () => proxy.kill(sig));
            };
            forwardSignal('SIGINT');
            forwardSignal('SIGTERM');

            try {
                await proxy.start();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: failed to start agent: ${message}\n`);
                cleanupDiscovery();
                await broadcaster?.stop();
                process.exit(1);
            }

            const { code, signal } = await proxy.waitForExit();

            if (session) {
                session.close();
                broadcaster?.publishSessionEnd(session.info);
            } else if (broadcaster) {
                broadcaster.publishSessionEnd({ ...sessionInfo, endedAt: Date.now() });
            }
            cleanupDiscovery();
            await broadcaster?.stop();

            if (signal) {
                process.kill(process.pid, signal);
            } else {
                process.exit(code ?? 0);
            }
        });
}
