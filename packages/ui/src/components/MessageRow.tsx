import { memo } from 'react';
import type { CapturedMessage } from '@acp-devtools/core';
import { extractTextPreview, isUserPrompt } from '@acp-devtools/core/acp/text';
import { cn } from '../lib/cn';
import {
    directionArrow,
    directionLabel,
    formatBytes,
    formatLatency,
    formatRpcId,
    formatTimeMs,
    latencyTone,
} from '../lib/format';
import type { ValidationResult } from '../lib/validation';

interface MessageRowProps {
    message: CapturedMessage;
    selected: boolean;
    paired?: boolean;
    latencyMs?: number;
    validation?: ValidationResult;
    onSelect: (seq: number) => void;
}

const KIND_BADGES: Record<CapturedMessage['kind'], string> = {
    request: 'REQ',
    response: 'RSP',
    notification: 'NTF',
    error: 'ERR',
    unknown: '???',
};

const KIND_TITLES: Record<CapturedMessage['kind'], string> = {
    request: 'request — expects a response',
    response: 'response — answer to a previous request',
    notification: 'notification — one-way event, no response',
    error: 'error — response carrying an error object',
    unknown: 'unknown — could not classify as JSON-RPC',
};

const DIRECTION_TITLES: Record<CapturedMessage['direction'], string> = {
    'editor-to-agent': 'editor → agent (e.g. JetBrains/Zed sending to the AI)',
    'agent-to-editor': 'agent → editor (AI replying or calling the host)',
};

function kindAccent(kind: CapturedMessage['kind']): string {
    switch (kind) {
        case 'error':
            return 'text-accent-error';
        case 'notification':
            return 'text-accent-note';
        case 'request':
            return 'text-accent-out';
        case 'response':
            return 'text-accent-in';
        default:
            return 'text-ink-muted';
    }
}

function MessageRowImpl({
    message,
    selected,
    paired = false,
    latencyMs,
    validation,
    onSelect,
}: MessageRowProps) {
    const isOut = message.direction === 'editor-to-agent';
    const isError = message.kind === 'error';
    const tone = latencyMs !== undefined ? latencyTone(latencyMs) : null;
    const preview = extractTextPreview(message);
    const isPrompt = isUserPrompt(message);
    const specBadge = validation && !validation.skipped && !validation.valid;

    return (
        <button
            type="button"
            onClick={() => onSelect(message.seq)}
            className={cn(
                'relative flex w-full items-center gap-3 px-4 py-1.5 text-left font-mono text-[12px] leading-5',
                'border-b border-line-grid/70 transition-colors',
                'hover:bg-surface-rowHover',
                selected ? 'bg-surface-rowHover ring-1 ring-inset ring-accent-out/40' : '',
                paired && !selected ? 'bg-accent-out/[0.04] ring-1 ring-inset ring-accent-out/15' : '',
                isError ? 'bg-accent-error/[0.06]' : '',
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'absolute inset-y-0 left-0 w-[3px]',
                    isOut ? 'bg-accent-out' : 'bg-accent-in',
                    isError ? 'bg-accent-error' : '',
                )}
            />
            <span className="w-10 shrink-0 text-right text-ink-muted">
                {String(message.seq).padStart(3, '0')}
            </span>
            <span className="w-24 shrink-0 text-ink-secondary">
                {formatTimeMs(message.timestamp)}
            </span>
            <span
                className={cn(
                    'flex w-16 shrink-0 items-center gap-1 font-semibold',
                    isOut ? 'text-accent-out' : 'text-accent-in',
                )}
                title={DIRECTION_TITLES[message.direction]}
            >
                <span aria-hidden>{directionArrow(message.direction)}</span>
                <span className="text-[10px] tracking-widest">
                    {directionLabel(message.direction)}
                </span>
            </span>
            <span
                className={cn(
                    'inline-flex w-12 shrink-0 items-center justify-center rounded-sm border px-1 text-[10px] font-semibold tracking-widest',
                    kindAccent(message.kind),
                    'border-current/40',
                )}
                title={KIND_TITLES[message.kind]}
            >
                {KIND_BADGES[message.kind]}
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-3 overflow-hidden">
                <span
                    className={cn(
                        'shrink-0',
                        isPrompt ? 'text-accent-out' : 'text-ink-primary',
                    )}
                >
                    {message.method ? message.method : '—'}
                </span>
                {specBadge && validation && (
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-accent-error/40',
                            'bg-accent-error/10 px-1 text-[9px] font-semibold uppercase tracking-widest text-accent-error',
                        )}
                        title={`fails ACP schema (${validation.schemaName ?? '?'}): ${validation.errors
                            .map((e) => `${e.path === '/' ? '' : e.path + ' '}${e.message}`)
                            .join(' · ')}`}
                    >
                        ⚠ SPEC {validation.errors.length}
                    </span>
                )}
                {preview && (
                    <span
                        className={cn(
                            'truncate',
                            isPrompt ? 'text-accent-out/85' : 'text-ink-secondary',
                        )}
                        title={preview}
                    >
                        “{preview}”
                    </span>
                )}
            </span>
            <span
                className="w-20 shrink-0 text-right text-ink-muted"
                title={
                    message.rpcId !== undefined && message.rpcId !== null
                        ? `id:${String(message.rpcId)}`
                        : undefined
                }
            >
                {message.rpcId !== undefined && message.rpcId !== null
                    ? `id:${formatRpcId(message.rpcId)}`
                    : ''}
            </span>
            <span className="w-20 shrink-0 text-right text-ink-muted">
                {formatBytes(message.raw.length)}
            </span>
            <span
                className={cn(
                    'w-20 shrink-0 text-right',
                    tone === 'ok' && 'text-accent-ok',
                    tone === 'warn' && 'text-accent-warn',
                    tone === 'error' && 'text-accent-error',
                    !tone && 'text-ink-dim',
                )}
            >
                {latencyMs !== undefined ? `+${formatLatency(latencyMs)}` : ''}
            </span>
        </button>
    );
}

export const MessageRow = memo(MessageRowImpl);
