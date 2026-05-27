import { useEffect, useMemo } from 'react';
import { extractSessionMetadata, type SessionMetadata } from '@acp-devtools/core/acp/session-metadata';
import { useMessagesStore } from '../store/messagesStore';
import { sessionHeader } from '../lib/captureLabel';
import { formatDateTime } from '../lib/format';
import { useDrawerAnimation } from '../lib/useDrawerAnimation';
import { useNow } from '../lib/useNow';
import { JsonTree } from './JsonTree';
import { cn } from '../lib/cn';

interface SessionInfoPanelProps {
    open: boolean;
    onClose: () => void;
}

export function SessionInfoPanel({ open, onClose }: SessionInfoPanelProps) {
    const session = useMessagesStore((s) => s.session);
    const messages = useMessagesStore((s) => s.messages);
    const meta = useMemo<SessionMetadata>(() => extractSessionMetadata(messages), [messages]);
    const { rendered, visible } = useDrawerAnimation(open);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, onClose]);

    if (!rendered) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Session info"
            className={cn(
                'fixed inset-0 z-[100] flex items-start justify-end bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out',
                visible ? 'opacity-100' : 'opacity-0',
            )}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className={cn(
                    'flex h-full w-full max-w-[440px] flex-col border-l border-line bg-surface-base shadow-2xl transition-transform duration-200 ease-out',
                    visible ? 'translate-x-0' : 'translate-x-full',
                )}
            >
                <header className="flex items-center justify-between border-b border-line px-5 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                        Session info
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:text-ink-primary"
                        aria-label="Close session info panel"
                    >
                        close
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {session ? (
                        <Body session={session} meta={meta} messages={messages} />
                    ) : (
                        <div className="font-mono text-[11px] text-ink-muted">
                            No session attached.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Body({
    session,
    meta,
    messages,
}: {
    session: NonNullable<ReturnType<typeof useMessagesStore.getState>['session']>;
    meta: SessionMetadata;
    messages: ReturnType<typeof useMessagesStore.getState>['messages'];
}) {
    const now = useNow(5000);
    const { primary } = sessionHeader(session);
    const counts = useMemo(() => countByKind(messages), [messages]);

    return (
        <div className="space-y-5 text-[12px]">
            <Section title="Summary">
                <Row label="Session" value={primary} />
                <Row
                    label="Client"
                    value={
                        meta.client.title ||
                        meta.client.name ||
                        session.clientName ||
                        '—'
                    }
                    secondary={
                        meta.client.version
                            ? `v${meta.client.version}${meta.client.platform ? ` · ${meta.client.platform}` : ''}`
                            : null
                    }
                />
                <Row
                    label="Agent"
                    value={meta.agent.name || shortAgent(session.agentCommand) || '—'}
                    secondary={meta.agent.version ? `v${meta.agent.version}` : null}
                />
                <Row
                    label="Protocol"
                    value={meta.protocolVersion !== null ? `ACP v${meta.protocolVersion}` : '—'}
                />
                <Row label="Started" value={formatDateTime(session.startedAt, now)} />
                <Row
                    label="Messages"
                    value={`${messages.length} (req ${counts.req} · rsp ${counts.rsp} · ntf ${counts.note} · err ${counts.err})`}
                />
            </Section>

            <Section title="Client capabilities">
                <CapRow label="fs.readTextFile" enabled={meta.clientCapabilities.fsReadTextFile} />
                <CapRow label="fs.writeTextFile" enabled={meta.clientCapabilities.fsWriteTextFile} />
                <CapRow label="terminal" enabled={meta.clientCapabilities.terminal} />
                <CapRow label="auth.terminal" enabled={meta.clientCapabilities.authTerminal} />
                <CapRow label="auth.gateway" enabled={meta.clientCapabilities.authGateway} />
            </Section>

            <Section title="Agent capabilities">
                <CapRow label="prompt" enabled={meta.agentCapabilities.prompt} />
                <CapRow label="loadSession" enabled={meta.agentCapabilities.loadSession} />
                <Row label="Auth methods" value={String(meta.agent.authMethods)} />
            </Section>

            <Section title="Runtime state">
                <Row
                    label="Mode"
                    value={meta.runtime.currentMode ?? '—'}
                    secondary={
                        meta.runtime.modeChanges > 0
                            ? `changed ${meta.runtime.modeChanges}× this session`
                            : null
                    }
                />
                <Row
                    label="Model"
                    value={meta.runtime.currentModel ?? '—'}
                    secondary={
                        meta.runtime.modelChanges > 0
                            ? `changed ${meta.runtime.modelChanges}× this session`
                            : null
                    }
                />
                <Row
                    label="Commands"
                    value={
                        meta.runtime.availableCommands.length > 0
                            ? meta.runtime.availableCommands.join(', ')
                            : '—'
                    }
                    wrap
                />
            </Section>

            {meta.extensions.jetbrainsProxyConfig !== null && (
                <Section title="JetBrains extensions">
                    <div className="rounded-sm border border-line bg-surface-elev p-3 font-mono text-[11px] text-ink-secondary">
                        <JsonTree value={meta.extensions.jetbrainsProxyConfig} />
                    </div>
                </Section>
            )}
        </div>
    );
}

function shortAgent(agentCommand: string | null): string | null {
    if (!agentCommand) return null;
    const parts = agentCommand.trim().split(/\s+/);
    if (parts[0] === 'npx') {
        for (let i = 1; i < parts.length; i++) {
            const t = parts[i]!;
            if (t.startsWith('-')) continue;
            return t;
        }
    }
    return parts[0] ?? null;
}

interface Counts {
    req: number;
    rsp: number;
    note: number;
    err: number;
}

function countByKind(messages: ReturnType<typeof useMessagesStore.getState>['messages']): Counts {
    let req = 0;
    let rsp = 0;
    let note = 0;
    let err = 0;
    for (const m of messages) {
        if (m.kind === 'request') req++;
        else if (m.kind === 'response') rsp++;
        else if (m.kind === 'notification') note++;
        else if (m.kind === 'error') err++;
    }
    return { req, rsp, note, err };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                {title}
            </h3>
            <div className="space-y-1.5">{children}</div>
        </div>
    );
}

function Row({
    label,
    value,
    secondary,
    wrap = false,
}: {
    label: string;
    value: string;
    secondary?: string | null;
    /** When true, long values wrap onto multiple lines instead of truncating. */
    wrap?: boolean;
}) {
    return (
        <div className="flex items-baseline gap-3">
            <span className="w-[120px] shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                {label}
            </span>
            <span
                className={cn(
                    'flex-1 text-ink-primary',
                    wrap ? 'whitespace-normal break-words' : 'truncate',
                )}
                title={wrap ? undefined : value}
            >
                {value}
                {secondary && (
                    <span className="ml-2 text-[10px] text-ink-muted">{secondary}</span>
                )}
            </span>
        </div>
    );
}

function CapRow({ label, enabled }: { label: string; enabled: boolean }) {
    return (
        <div className="flex items-baseline gap-3">
            <span className="w-[120px] shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                {label}
            </span>
            <span
                className={cn(
                    'flex-1 font-mono text-[11px]',
                    enabled ? 'text-accent-ok' : 'text-ink-dim',
                )}
            >
                {enabled ? '✓ enabled' : '— not advertised'}
            </span>
        </div>
    );
}
