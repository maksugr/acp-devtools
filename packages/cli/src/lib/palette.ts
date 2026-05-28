import type { CapturedMessage } from '@acp-devtools/core';
import type { Styler } from './style.js';

// Semantic colours shared across command outputs. Each takes the styler so the
// caller controls whether colour is on (TTY) — disabled stylers return the text
// unchanged, so these are safe to call unconditionally.

export function colorKind(s: Styler, kind: CapturedMessage['kind'], text: string): string {
    switch (kind) {
        case 'request':
            return s.green(text);
        case 'response':
            return s.cyan(text);
        case 'notification':
            return s.yellow(text);
        case 'error':
            return s.red(text);
        default:
            return s.dim(text);
    }
}

export function colorDirection(
    s: Styler,
    direction: CapturedMessage['direction'],
    text: string,
): string {
    return direction === 'editor-to-agent' ? s.green(text) : s.cyan(text);
}

export function colorLatency(s: Styler, ms: number, text: string): string {
    if (ms < 200) return s.green(text);
    if (ms < 1000) return text;
    if (ms < 5000) return s.yellow(text);
    return s.red(text);
}

export function colorSessionKind(s: Styler, imported: boolean, text: string): string {
    return imported ? s.yellow(text) : s.green(text);
}
