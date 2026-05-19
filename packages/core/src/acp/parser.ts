import type {
    JsonRpcErrorResponse,
    JsonRpcId,
    JsonRpcMessage,
    JsonRpcRequest,
    JsonRpcNotification,
    JsonRpcSuccessResponse,
    MessageKind,
} from './types.js';

/**
 * Splits a UTF-8 byte/string stream into newline-delimited frames.
 *
 * The ACP wire format guarantees that every message is a single JSON-RPC
 * object terminated by `\n` and that messages MUST NOT contain embedded
 * newlines, so simple line-buffering is sufficient. The parser tolerates
 * `\r\n` by trimming a trailing `\r` and ignores empty lines.
 */
export class LineFramer {
    private buffer = '';

    /** Push a chunk; returns zero or more complete frames (without the trailing `\n`). */
    feed(chunk: Buffer | string): string[] {
        this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const lines: string[] = [];
        let nl = this.buffer.indexOf('\n');
        while (nl >= 0) {
            let line = this.buffer.slice(0, nl);
            this.buffer = this.buffer.slice(nl + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (line.length > 0) lines.push(line);
            nl = this.buffer.indexOf('\n');
        }
        return lines;
    }

    /** Return and discard any unterminated trailing data. */
    flush(): string | null {
        if (this.buffer.length === 0) return null;
        const remaining = this.buffer;
        this.buffer = '';
        return remaining.length > 0 ? remaining : null;
    }
}

export interface ParsedFrame {
    raw: string;
    payload: JsonRpcMessage | null;
    kind: MessageKind;
    method?: string;
    rpcId?: JsonRpcId | null;
    parseError?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classify(payload: JsonRpcMessage): {
    kind: MessageKind;
    method?: string;
    rpcId?: JsonRpcId | null;
} {
    if ('method' in payload && 'id' in payload) {
        const req = payload as JsonRpcRequest;
        return { kind: 'request', method: req.method, rpcId: req.id };
    }
    if ('method' in payload) {
        const note = payload as JsonRpcNotification;
        return { kind: 'notification', method: note.method };
    }
    if ('error' in payload) {
        const err = payload as JsonRpcErrorResponse;
        return { kind: 'error', rpcId: err.id ?? null };
    }
    if ('result' in payload) {
        const ok = payload as JsonRpcSuccessResponse;
        return { kind: 'response', rpcId: ok.id ?? null };
    }
    return { kind: 'unknown' };
}

/** Parse a single newline-delimited frame as JSON-RPC. Never throws. */
export function parseFrame(raw: string): ParsedFrame {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { raw, payload: null, kind: 'unknown', parseError: `invalid JSON: ${message}` };
    }
    if (!isPlainObject(json) || json.jsonrpc !== '2.0') {
        return { raw, payload: null, kind: 'unknown', parseError: 'not a JSON-RPC 2.0 message' };
    }
    const payload = json as unknown as JsonRpcMessage;
    return { raw, payload, ...classify(payload) };
}
