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

/**
 * Keys whose contents exist to carry credentials. ACP sends MCP-server
 * headers and env as lists of `{ name, value }` pairs (`HttpHeader`,
 * `EnvVariable` in `session/new` / `session/load`), and terminal-auth env as
 * a plain map (`AuthMethodTerminal.env`). Every value under these keys is
 * masked — the names stay, so a reader can still see *which* variables or
 * headers were passed.
 */
const CREDENTIAL_LIST_KEYS = new Set(['headers', 'env']);

interface NameValuePair {
    name: string;
    value: string;
}

function isNameValuePair(v: unknown): v is NameValuePair {
    return (
        v !== null &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        typeof (v as Record<string, unknown>)['name'] === 'string' &&
        typeof (v as Record<string, unknown>)['value'] === 'string'
    );
}

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
        // `{ name: "Authorization", value: "Bearer …" }` anywhere in the tree.
        if (isNameValuePair(value) && SENSITIVE_HEADER_NAMES.has(value.name.toLowerCase())) {
            return redactPair(value, ctx);
        }
        let count = 0;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (typeof v === 'string' && SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
                out[k] = REDACTED_PLACEHOLDER;
                count += 1;
                continue;
            }
            if (CREDENTIAL_LIST_KEYS.has(k.toLowerCase())) {
                if (Array.isArray(v) && v.some(isNameValuePair)) {
                    const r = redactPairList(v, ctx);
                    out[k] = r.value;
                    count += r.count;
                    continue;
                }
                if (
                    k.toLowerCase() === 'env' &&
                    v !== null &&
                    typeof v === 'object' &&
                    !Array.isArray(v)
                ) {
                    const r = redactHeadersBlock(v as Record<string, unknown>);
                    out[k] = r.value;
                    count += r.count;
                    continue;
                }
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

/** Mask a pair's `value` (key order kept); other fields get the normal rules. */
function redactPair(pair: NameValuePair, ctx: RedactCtx): { value: unknown; count: number } {
    let count = pair.value === REDACTED_PLACEHOLDER ? 0 : 1;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pair)) {
        if (k === 'value' || k === 'name') {
            out[k] = k === 'value' ? REDACTED_PLACEHOLDER : v;
            continue;
        }
        const r = redactValue(v, ctx);
        out[k] = r.value;
        count += r.count;
    }
    return { value: out, count };
}

/** Mask the `value` of every `{ name, value }` item; recurse into anything else. */
function redactPairList(list: unknown[], ctx: RedactCtx): { value: unknown[]; count: number } {
    let count = 0;
    const out = list.map((item) => {
        const r = isNameValuePair(item) ? redactPair(item, ctx) : redactValue(item, ctx);
        count += r.count;
        return r.value;
    });
    return { value: out, count };
}

/** Mask every string value of a map (header map, env map). */
function redactHeadersBlock(obj: Record<string, unknown>): {
    value: Record<string, unknown>;
    count: number;
} {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            out[k] = REDACTED_PLACEHOLDER;
            if (v !== REDACTED_PLACEHOLDER) count += 1;
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
