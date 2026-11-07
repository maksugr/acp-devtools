import { useMemo, useState } from 'react';
import type { CapturedMessage } from '@acp-devtools/core';
import { resolveSpecForMessage } from '@acp-devtools/core/acp/spec-decoder';
import { cn } from '../lib/cn';
import { SpecHint } from './SpecHint';
import {
    directionArrow,
    directionLabel,
    formatBytes,
    formatLatency,
    formatTimeMs,
} from '../lib/format';
import type { ValidationResult } from '../lib/validation';
import { JsonTree } from './JsonTree';
import { useMessagesStore, type DetailTab } from '../store/messagesStore';

interface DetailPanelProps {
    message: CapturedMessage | null;
    latencyMs?: number;
    pairedRequest?: CapturedMessage | null;
    onJumpToPaired?: ((seq: number) => void) | undefined;
    validation?: ValidationResult;
}

export function DetailPanel({
    message,
    latencyMs,
    pairedRequest,
    onJumpToPaired,
    validation,
}: DetailPanelProps) {
    const tab = useMessagesStore((s) => s.detailTab);
    const setTab = useMessagesStore((s) => s.setDetailTab);

    // Read the frame with the same protocol version its validation used, so
    // field hints and the ⚠ SPEC badge come from the same schema.
    const protocolVersion = validation?.protocolVersion;
    const resolver = useMemo(() => {
        if (!message) return null;
        const pairedMethod = pairedRequest?.method ?? undefined;
        return resolveSpecForMessage(message, {
            ...(pairedMethod ? { pairedMethod } : {}),
            ...(protocolVersion !== undefined ? { protocolVersion } : {}),
        });
    }, [message, pairedRequest, protocolVersion]);

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
                    <KindField message={message} resolver={resolver} />
                    {message.rpcId !== undefined && message.rpcId !== null && (
                        <Field label="id" value={String(message.rpcId)} />
                    )}
                    <Field label="bytes" value={formatBytes(message.raw.length)} />
                    {latencyMs !== undefined && (
                        <Field label="latency" value={`+${formatLatency(latencyMs)}`} accent />
                    )}
                    {pairedRequest && (
                        <button
                            type="button"
                            onClick={
                                onJumpToPaired ? () => onJumpToPaired(pairedRequest.seq) : undefined
                            }
                            className="inline-flex items-baseline gap-1 transition-colors hover:text-ink-primary"
                            title="jump to paired message"
                        >
                            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
                                paired
                            </span>
                            <span className="text-ink-primary underline decoration-line-strong decoration-dotted underline-offset-4">
                                seq {pairedRequest.seq} {pairedRequest.method ?? ''}
                            </span>
                        </button>
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
                <TabButton
                    active={tab === 'spec'}
                    onClick={() => setTab('spec')}
                    badge={
                        validation && !validation.skipped && !validation.valid
                            ? validation.errors.length
                            : undefined
                    }
                    advisoryBadge={
                        validation && !validation.skipped && validation.advisories?.length
                            ? validation.advisories.length
                            : undefined
                    }
                >
                    Spec
                </TabButton>
            </nav>

            <div className="flex-1 overflow-auto px-5 py-4">
                {tab === 'tree' && <TreeView message={message} resolver={resolver} />}
                {tab === 'raw' && <RawView raw={message.raw} />}
                {tab === 'meta' && <MetaView message={message} />}
                {tab === 'spec' && <SpecView validation={validation} />}
            </div>
        </div>
    );
}

function SpecView({ validation }: { validation: ValidationResult | undefined }) {
    if (!validation) {
        return <div className="font-mono text-[11px] text-ink-muted">no validation result yet</div>;
    }
    if (validation.skipped) {
        const explainer: Record<NonNullable<ValidationResult['skipped']>, string> = {
            'parse-error':
                'this frame failed to parse as JSON-RPC — already surfaced in the Tree tab as a parse error',
            'no-method':
                'no method available for validation (e.g. response without a paired request)',
            'unknown-method':
                'the ACP spec has no schema for this method — likely an extension or a future addition',
            'no-schema-for-kind':
                'the spec has no schema for this kind of frame for this method (e.g. notification-only method)',
            'wrong-kind':
                'no per-method ACP schema applies (e.g. JSON-RPC error envelope, parse failure)',
            'unsupported-protocol-version': `the session negotiated ACP v${validation.protocolVersion ?? '?'}, which acp-devtools has no schema for`,
        };
        return (
            <div className="space-y-2 font-mono text-[11px]">
                <div className="text-ink-muted uppercase tracking-widest text-[10px]">
                    not validated
                </div>
                <div className="text-ink-secondary">{explainer[validation.skipped]}</div>
            </div>
        );
    }
    if (validation.valid) {
        return (
            <div className="space-y-3 font-mono text-[11px]">
                <div className="inline-flex items-baseline gap-2">
                    <span className="rounded-sm border border-accent-ok/40 bg-accent-ok/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent-ok">
                        ✓ conforms
                    </span>
                    <span className="text-ink-muted">
                        matched <span className="text-ink-secondary">{validation.schemaName}</span>{' '}
                        from the ACP v{validation.protocolVersion ?? 1} schema
                    </span>
                </div>
                <AdvisoryBlock advisories={validation.advisories} />
            </div>
        );
    }
    return (
        <div className="space-y-3 font-mono text-[11px]">
            <div className="inline-flex items-baseline gap-2">
                <span className="rounded-sm border border-accent-error/40 bg-accent-error/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent-error">
                    ⚠ {validation.errors.length} violation
                    {validation.errors.length === 1 ? '' : 's'}
                </span>
                <span className="text-ink-muted">
                    against <span className="text-ink-secondary">{validation.schemaName}</span> (ACP
                    v{validation.protocolVersion ?? 1})
                </span>
            </div>
            <ul className="space-y-1.5">
                {validation.errors.map((e, i) => (
                    <li
                        key={`${e.path}-${e.keyword}-${i}`}
                        className="rounded-sm border border-accent-error/25 bg-accent-error/[0.04] px-2 py-1.5"
                    >
                        <div className="text-[10px] uppercase tracking-widest text-ink-muted">
                            {e.keyword ?? 'error'} · {e.path === '/' ? '(root)' : e.path}
                        </div>
                        <div className="mt-0.5 text-ink-primary">{e.message}</div>
                    </li>
                ))}
            </ul>
            <AdvisoryBlock advisories={validation.advisories} />
        </div>
    );
}

function AdvisoryBlock({ advisories }: { advisories: ValidationResult['advisories'] }) {
    if (!advisories || advisories.length === 0) return null;
    return (
        <div className="space-y-1.5">
            <div className="inline-flex items-baseline gap-2">
                <span className="rounded-sm border border-accent-warn/40 bg-accent-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent-warn">
                    ⚠ {advisories.length} advisor{advisories.length === 1 ? 'y' : 'ies'}
                </span>
                <span className="text-ink-muted">
                    valid today — required in a future ACP version
                </span>
            </div>
            <ul className="space-y-1.5">
                {advisories.map((a, i) => (
                    <li
                        key={`${a.path}-${i}`}
                        className="rounded-sm border border-accent-warn/25 bg-accent-warn/[0.04] px-2 py-1.5"
                    >
                        <div className="text-[10px] uppercase tracking-widest text-ink-muted">
                            soon-required · {a.path}
                        </div>
                        <div className="mt-0.5 text-ink-primary">{a.message}</div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function TreeView({
    message,
    resolver,
}: {
    message: CapturedMessage;
    resolver: ReturnType<typeof resolveSpecForMessage> | null;
}) {
    const getSpec = useMemo(() => {
        if (!resolver) return undefined;
        return (path: string[]) => resolver.resolve(path);
    }, [resolver]);

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

    return <JsonTree value={message.payload} defaultExpanded {...(getSpec ? { getSpec } : {})} />;
}

function RawView({ raw }: { raw: string }) {
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(raw);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard API may be unavailable in non-secure contexts —
            // fall back to a no-op rather than crashing.
        }
    };
    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onCopy}
                aria-label="Copy raw frame to clipboard"
                title="Copy raw frame to clipboard"
                className={cn(
                    // Hidden by default; the parent's `group-hover` reveals it
                    // with a translucent (70%) surface fill so it doesn't
                    // dominate the raw text underneath. Direct hover flips to
                    // a fully solid bg-surface-rowHover + accent for a clear
                    // "I'm clickable" state.
                    'absolute right-0 top-0 inline-flex h-6 items-center rounded-sm border bg-surface-elev/70 px-2 font-mono text-[10px] uppercase tracking-widest opacity-0 transition-[opacity,background-color,border-color,color] duration-150',
                    'group-hover:opacity-100 focus-visible:opacity-100',
                    copied
                        ? 'border-accent-ok/60 bg-surface-elev text-accent-ok opacity-100'
                        : 'border-line text-ink-secondary hover:border-accent-info/70 hover:bg-surface-rowHover hover:text-accent-info',
                )}
            >
                {copied ? '✓ copied' : 'copy'}
            </button>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ink-primary">
                {raw}
            </pre>
        </div>
    );
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

function KindField({
    message,
    resolver,
}: {
    message: CapturedMessage;
    resolver: ReturnType<typeof resolveSpecForMessage> | null;
}) {
    const field = <Field label="kind" value={message.kind} />;
    if (!resolver?.typeDescription) return field;
    return (
        <SpecHint
            label={
                <div className="whitespace-pre-wrap font-sans text-[12px] leading-snug text-ink-secondary">
                    {resolver.typeDescription}
                </div>
            }
            tone="info"
        >
            {field}
        </SpecHint>
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
    badge,
    advisoryBadge,
    tab: _tab,
}: {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
    badge?: number;
    advisoryBadge?: number;
    tab?: DetailTab;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'relative flex items-baseline gap-1.5 px-4 py-2 font-mono text-[11px] uppercase tracking-widest transition-colors',
                active ? 'text-ink-primary' : 'text-ink-muted hover:text-ink-secondary',
            )}
        >
            <span>{children}</span>
            {badge !== undefined && (
                <span className="rounded-sm border border-accent-error/40 bg-accent-error/10 px-1 text-[9px] font-semibold text-accent-error">
                    {badge}
                </span>
            )}
            {advisoryBadge !== undefined && (
                <span className="rounded-sm border border-accent-warn/40 bg-accent-warn/10 px-1 text-[9px] font-semibold text-accent-warn">
                    {advisoryBadge}
                </span>
            )}
            {active && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-accent-out" aria-hidden />
            )}
        </button>
    );
}
