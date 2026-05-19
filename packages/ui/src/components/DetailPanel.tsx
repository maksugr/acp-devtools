import { useState } from 'react';
import type { CapturedMessage } from '@acp-devtools/core';
import { cn } from '../lib/cn';
import {
    directionArrow,
    directionLabel,
    formatBytes,
    formatLatency,
    formatTimeMs,
} from '../lib/format';
import { JsonTree } from './JsonTree';

interface DetailPanelProps {
    message: CapturedMessage | null;
    latencyMs?: number;
    pairedRequest?: CapturedMessage | null;
}

type Tab = 'tree' | 'raw' | 'meta';

export function DetailPanel({ message, latencyMs, pairedRequest }: DetailPanelProps) {
    const [tab, setTab] = useState<Tab>('tree');

    if (!message) {
        return (
            <div className="flex h-full items-center justify-center bg-surface-elev/40">
                <div className="text-center font-mono text-xs uppercase tracking-widest text-ink-muted">
                    select a message to inspect
                </div>
            </div>
        );
    }

    const isOut = message.direction === 'editor-to-agent';

    return (
        <div className="flex h-full flex-col bg-surface-elev/30">
            <header className="border-b border-line bg-surface-elev px-5 py-3">
                <div className="flex items-baseline gap-3">
                    <span
                        className={cn(
                            'font-mono text-[11px] font-semibold tracking-widest',
                            isOut ? 'text-accent-out' : 'text-accent-in',
                        )}
                    >
                        {directionArrow(message.direction)} {directionLabel(message.direction)}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">seq {message.seq}</span>
                    <span className="font-mono text-xs text-ink-muted">
                        {formatTimeMs(message.timestamp)}
                    </span>
                </div>
                <h2 className="mt-1 truncate font-display text-lg uppercase tracking-tight text-ink-primary">
                    {message.method ?? message.kind}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-secondary">
                    <Field label="kind" value={message.kind} />
                    {message.rpcId !== undefined && message.rpcId !== null && (
                        <Field label="id" value={String(message.rpcId)} />
                    )}
                    <Field label="bytes" value={formatBytes(message.raw.length)} />
                    {latencyMs !== undefined && (
                        <Field label="latency" value={`+${formatLatency(latencyMs)}`} accent />
                    )}
                    {pairedRequest && (
                        <Field
                            label="paired"
                            value={`seq ${pairedRequest.seq} ${pairedRequest.method ?? ''}`}
                        />
                    )}
                </div>
            </header>

            <nav className="flex gap-1 border-b border-line bg-surface-elev/70 px-4">
                <TabButton active={tab === 'tree'} onClick={() => setTab('tree')}>
                    Tree
                </TabButton>
                <TabButton active={tab === 'raw'} onClick={() => setTab('raw')}>
                    Raw
                </TabButton>
                <TabButton active={tab === 'meta'} onClick={() => setTab('meta')}>
                    Meta
                </TabButton>
            </nav>

            <div className="flex-1 overflow-auto px-5 py-4">
                {tab === 'tree' && <TreeView message={message} />}
                {tab === 'raw' && (
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ink-primary">
                        {message.raw}
                    </pre>
                )}
                {tab === 'meta' && <MetaView message={message} />}
            </div>
        </div>
    );
}

function TreeView({ message }: { message: CapturedMessage }) {
    if (message.payload === null) {
        return (
            <div className="space-y-2 font-mono text-xs">
                <div className="text-accent-error">
                    parse error: {message.parseError ?? 'unknown'}
                </div>
                <pre className="whitespace-pre-wrap break-all text-ink-secondary">
                    {message.raw}
                </pre>
            </div>
        );
    }
    return <JsonTree value={message.payload} defaultExpanded />;
}

function MetaView({ message }: { message: CapturedMessage }) {
    const entries: Array<[string, string]> = [
        ['seq', String(message.seq)],
        ['direction', message.direction],
        ['kind', message.kind],
        ['method', message.method ?? '(none)'],
        ['rpcId', String(message.rpcId ?? '(none)')],
        ['timestamp', `${formatTimeMs(message.timestamp)} (${message.timestamp})`],
        ['raw size', formatBytes(message.raw.length)],
        ['parse error', message.parseError ?? '(none)'],
    ];
    return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
            {entries.map(([k, v]) => (
                <div key={k} className="contents">
                    <dt className="text-ink-muted uppercase tracking-widest text-[10px]">{k}</dt>
                    <dd className="text-ink-primary">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <span className="inline-flex items-baseline gap-1">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">{label}</span>
            <span className={cn(accent ? 'text-accent-warn' : 'text-ink-primary')}>{value}</span>
        </span>
    );
}

function TabButton({
    children,
    active,
    onClick,
}: {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'relative px-4 py-2 font-mono text-[11px] uppercase tracking-widest transition-colors',
                active ? 'text-ink-primary' : 'text-ink-muted hover:text-ink-secondary',
            )}
        >
            {children}
            {active && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-accent-out" aria-hidden />
            )}
        </button>
    );
}
