import type { CapturedMessage, JsonRpcMessage } from '../acp/types.js';
import type { SessionExport } from './export.js';

export const REDACTED_PLACEHOLDER = '<REDACTED>';

const SENSITIVE_HEADER_NAMES = new Set([
    'authorization',
    'proxy-authorization',
    'proxy-authentication',
    'x-api-key',
    'x-api-token',
    'x-auth-token',
    'api-key',
    'api_key',
    'proxy_key',
    'cookie',
    'set-cookie',
]);

interface RedactCtx {
    /** True once we've descended into a `proxyConfig` subtree — then every
     *  string value of a nested `headers` object is treated as auth, even if
     *  the header NAME isn't in the static allowlist (catches future JetBrains
     *  fields like a renamed `proxy_key`). */
    inProxyConfig: boolean;
}

export interface RedactedMessage {
    redacted: CapturedMessage;
    count: number;
}

export function redactMessage(message: CapturedMessage): RedactedMessage {
    if (message.payload == null) {
        return { redacted: message, count: 0 };
    }
    const { value, count } = redactValue(message.payload, { inProxyConfig: false });
    if (count === 0) {
        return { redacted: message, count: 0 };
    }
    const redactedPayload = value as JsonRpcMessage;
    return {
        redacted: {
            ...message,
            payload: redactedPayload,
            raw: JSON.stringify(redactedPayload),
        },
        count,
    };
}

function redactValue(value: unknown, ctx: RedactCtx): { value: unknown; count: number } {
    if (Array.isArray(value)) {
        let count = 0;
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const r = redactValue(value[i], ctx);
            out[i] = r.value;
            count += r.count;
        }
        return { value: out, count };
    }
    if (value !== null && typeof value === 'object') {
        let count = 0;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (typeof v === 'string' && SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
                out[k] = REDACTED_PLACEHOLDER;
                count += 1;
                continue;
            }
            if (
                ctx.inProxyConfig &&
                k === 'headers' &&
                v !== null &&
                typeof v === 'object' &&
                !Array.isArray(v)
            ) {
                const r = redactHeadersBlock(v as Record<string, unknown>);
                out[k] = r.value;
                count += r.count;
                continue;
            }
            const childCtx: RedactCtx =
                ctx.inProxyConfig || k.toLowerCase() === 'proxyconfig'
                    ? { inProxyConfig: true }
                    : ctx;
            const r = redactValue(v, childCtx);
            out[k] = r.value;
            count += r.count;
        }
        return { value: out, count };
    }
    return { value, count: 0 };
}

function redactHeadersBlock(obj: Record<string, unknown>): {
    value: Record<string, unknown>;
    count: number;
} {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            out[k] = REDACTED_PLACEHOLDER;
            count += 1;
        } else {
            out[k] = v;
        }
    }
    return { value: out, count };
}

export interface RedactedExport {
    export: SessionExport;
    messagesAffected: number;
    fieldsRedacted: number;
}

export function redactSessionExport(exp: SessionExport): RedactedExport {
    let messagesAffected = 0;
    let fieldsRedacted = 0;
    const messages = exp.messages.map((msg) => {
        const r = redactMessage(msg);
        if (r.count > 0) {
            messagesAffected += 1;
            fieldsRedacted += r.count;
        }
        return r.redacted;
    });
    if (fieldsRedacted === 0) {
        return { export: exp, messagesAffected: 0, fieldsRedacted: 0 };
    }
    return {
        export: { ...exp, messages },
        messagesAffected,
        fieldsRedacted,
    };
}
