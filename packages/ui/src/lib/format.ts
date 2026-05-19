import type { CapturedMessage } from '@acp-devtools/core';

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

export function formatTime(ts: number): string {
    return TIME_FMT.format(ts);
}

export function formatTimeMs(ts: number): string {
    const ms = ts % 1000;
    return `${formatTime(ts)}.${String(ms).padStart(3, '0')}`;
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLatency(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

export function formatRelative(ts: number, base: number): string {
    const delta = ts - base;
    const seconds = Math.floor(delta / 1000);
    if (seconds < 60) return `+${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `+${minutes}m${rem.toString().padStart(2, '0')}s`;
}

export function latencyTone(ms: number): 'ok' | 'warn' | 'error' {
    if (ms < 250) return 'ok';
    if (ms < 1500) return 'warn';
    return 'error';
}

export function directionLabel(d: CapturedMessage['direction']): string {
    return d === 'editor-to-agent' ? 'OUT' : 'IN';
}

export function directionArrow(d: CapturedMessage['direction']): string {
    return d === 'editor-to-agent' ? '→' : '←';
}

export function shortMethod(method: string | undefined): string {
    if (!method) return '—';
    return method;
}

export function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const a = sorted[lo];
    const b = sorted[hi];
    if (a === undefined || b === undefined) return a ?? 0;
    if (lo === hi) return a;
    return a + (b - a) * (rank - lo);
}
