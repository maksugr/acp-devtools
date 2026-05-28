import type { Command } from 'commander';
import {
    type CapturedMessage,
    Session,
    defaultCapturesDbPath,
    extractSessionMetadata,
    openExistingDatabase,
} from '@acp-devtools/core';
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';

interface SessionInfoOptions {
    db: string;
    json?: boolean;
}

export function registerSessionInfoCommand(program: Command): void {
    program
        .command('session-info')
        .description(
            'Print derived client/agent metadata for a saved session — the terminal equivalent of the inspector\'s session info panel.',
        )
        .argument('<id>', 'session id (see `acp-devtools list`)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--json', 'machine-readable JSON instead of human-readable text')
        .action((rawId: string, opts: SessionInfoOptions) => {
            const id = Number(rawId);
            if (!Number.isInteger(id) || id <= 0) {
                process.stderr.write(`acp-devtools: invalid id "${rawId}"\n`);
                process.exit(2);
            }
            let db;
            try {
                db = openExistingDatabase(opts.db);
            } catch (err) {
                process.stderr.write(
                    `acp-devtools: cannot open ${opts.db}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
                process.exit(1);
            }
            let session: Session;
            try {
                session = Session.load(db, id);
            } catch (err) {
                process.stderr.write(
                    `acp-devtools: ${err instanceof Error ? err.message : String(err)}\n`,
                );
                db.close();
                process.exit(1);
            }

            const messages: CapturedMessage[] = [];
            for (const m of session.messages()) messages.push(m);
            const meta = extractSessionMetadata(messages);
            db.close();

            if (opts.json) {
                process.stdout.write(
                    JSON.stringify(
                        {
                            session: {
                                id: session.info.id,
                                name: session.info.name,
                                agentCommand: session.info.agentCommand,
                                startedAt: session.info.startedAt,
                                endedAt: session.info.endedAt,
                                clientName: session.info.clientName,
                                messageCount: messages.length,
                            },
                            metadata: meta,
                        },
                        null,
                        2,
                    ) + '\n',
                );
                return;
            }

            renderText(session, meta, messages.length);
        });
}

function renderText(session: Session, meta: ReturnType<typeof extractSessionMetadata>, msgCount: number): void {
    const w = process.stdout;
    const s = createStyler(colorEnabled(process.stdout));
    w.write(`${s.bold(s.cyan(`SESSION #${session.info.id}`))}\n`);
    w.write(s.dim('─'.repeat(48)) + '\n');
    const clientLabel = meta.client.title ?? meta.client.name ?? session.info.clientName ?? '—';
    const clientVer = meta.client.version ? ` v${meta.client.version}` : '';
    const clientPlatform = meta.client.platform ? ` (${meta.client.platform})` : '';
    w.write(pad(s, 'Client', `${clientLabel}${clientVer}${clientPlatform}`));

    const agentLabel = meta.agent.name ?? shortAgent(session.info.agentCommand) ?? '—';
    const agentVer = meta.agent.version ? ` v${meta.agent.version}` : '';
    w.write(pad(s, 'Agent', `${agentLabel}${agentVer}`));

    w.write(pad(s, 'Protocol', meta.protocolVersion !== null ? `ACP v${meta.protocolVersion}` : '—'));
    w.write(
        pad(
            s,
            'Started',
            new Date(session.info.startedAt).toISOString() +
                (session.info.endedAt !== null
                    ? ` → ${new Date(session.info.endedAt).toISOString()}`
                    : ''),
        ),
    );
    w.write(pad(s, 'Messages', String(msgCount)));

    w.write(`\n${heading(s, 'CLIENT CAPABILITIES')}\n`);
    w.write(capLine(s, 'fs.readTextFile', meta.clientCapabilities.fsReadTextFile));
    w.write(capLine(s, 'fs.writeTextFile', meta.clientCapabilities.fsWriteTextFile));
    w.write(capLine(s, 'terminal', meta.clientCapabilities.terminal));
    w.write(capLine(s, 'auth.terminal', meta.clientCapabilities.authTerminal));
    w.write(capLine(s, 'auth.gateway', meta.clientCapabilities.authGateway));

    w.write(`\n${heading(s, 'AGENT CAPABILITIES')}\n`);
    w.write(capLine(s, 'prompt', meta.agentCapabilities.prompt));
    w.write(capLine(s, 'loadSession', meta.agentCapabilities.loadSession));
    w.write(`  ${s.dim('auth methods'.padEnd(18))} ${meta.agent.authMethods}\n`);

    w.write(`\n${heading(s, 'RUNTIME STATE')}\n`);
    const modeSuffix = meta.runtime.modeChanges > 0 ? s.dim(`  (changed ${meta.runtime.modeChanges}×)`) : '';
    const modelSuffix =
        meta.runtime.modelChanges > 0 ? s.dim(`  (changed ${meta.runtime.modelChanges}×)`) : '';
    w.write(`  ${s.dim('current mode'.padEnd(18))} ${meta.runtime.currentMode ?? '—'}${modeSuffix}\n`);
    w.write(`  ${s.dim('current model'.padEnd(18))} ${meta.runtime.currentModel ?? '—'}${modelSuffix}\n`);
    w.write(
        `  ${s.dim('available cmds'.padEnd(18))} ${meta.runtime.availableCommands.length > 0 ? meta.runtime.availableCommands.join(', ') : '—'}\n`,
    );

    if (meta.extensions.jetbrainsProxyConfig !== null) {
        w.write(`\n${heading(s, 'JETBRAINS EXTENSIONS')}\n`);
        w.write(
            `  ${s.dim('proxyConfig'.padEnd(18))} ${JSON.stringify(meta.extensions.jetbrainsProxyConfig)}\n`,
        );
    }
}

function heading(s: Styler, label: string): string {
    return s.bold(s.yellow(label));
}

function pad(s: Styler, label: string, value: string): string {
    return `  ${s.dim(label.padEnd(18))} ${value}\n`;
}

function capLine(s: Styler, label: string, enabled: boolean): string {
    return `  ${s.dim(label.padEnd(18))} ${enabled ? s.green('✓') : s.dim('—')}\n`;
}

function shortAgent(agentCommand: string | null): string | null {
    if (!agentCommand) return null;
    const parts = agentCommand.trim().split(/\s+/).filter(Boolean);
    if (parts[0] === 'npx') {
        for (let i = 1; i < parts.length; i++) {
            const t = parts[i]!;
            if (!t.startsWith('-')) return t;
        }
    }
    return parts[0] ?? null;
}
