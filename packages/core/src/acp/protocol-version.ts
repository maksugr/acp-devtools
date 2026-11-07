import { rpcCorrelationKey } from './method-stats.js';
import type { CapturedMessage } from './types.js';

/**
 * ACP protocol versions acp-devtools has a schema for. `protocolVersion` is
 * negotiated in `initialize` and only bumped for breaking changes.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [1, 2] as const;
export type AcpProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Assumed when a capture has no `initialize` exchange (e.g. it starts mid-session). */
export const DEFAULT_PROTOCOL_VERSION: AcpProtocolVersion = 1;

export function isSupportedProtocolVersion(v: unknown): v is AcpProtocolVersion {
    return (SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(v);
}

function declaredVersion(msg: CapturedMessage): number | null {
    const payload = msg.payload as { params?: unknown; result?: unknown } | null;
    const body = msg.kind === 'request' ? payload?.params : payload?.result;
    const v = (body as { protocolVersion?: unknown } | null | undefined)?.protocolVersion;
    return typeof v === 'number' ? v : null;
}

/**
 * The protocol version a session runs on: the one the agent answered with in
 * its last successful `initialize` response. A client may repeat `initialize`
 * before any other request (to fall back to an older version the agent
 * offered), so the last answer wins. Falls back to the version the editor
 * requested when the response is missing, and to `null` when the capture has
 * no `initialize` at all.
 */
export function detectProtocolVersion(messages: readonly CapturedMessage[]): number | null {
    // Correlation keys of `initialize` requests still waiting for an answer;
    // ids can be reused once a request completes.
    const pendingInitialize = new Set<string>();
    let requested: number | null = null;
    let negotiated: number | null = null;
    for (const m of messages) {
        if (
            m.kind === 'request' &&
            m.method === 'initialize' &&
            m.direction === 'editor-to-agent'
        ) {
            const key = rpcCorrelationKey(m);
            if (key) pendingInitialize.add(key);
            requested = declaredVersion(m) ?? requested;
        } else if (m.kind === 'response' && m.direction === 'agent-to-editor') {
            const key = rpcCorrelationKey(m);
            if (key && pendingInitialize.delete(key)) negotiated = declaredVersion(m) ?? negotiated;
        }
    }
    return negotiated ?? requested;
}

/**
 * The protocol version to read one frame with. `initialize` request and
 * response carry their own `protocolVersion` — during a fallback the editor's
 * first `initialize` can be a v2 frame in a session that ends up on v1 — so
 * they are read with the version they declare; every other frame uses the
 * session's version.
 */
export function frameProtocolVersion(
    msg: CapturedMessage,
    sessionVersion: number | null,
    pairedMethod?: string,
): number {
    const isInitialize =
        (msg.kind === 'request' && msg.method === 'initialize') ||
        (msg.kind === 'response' && pairedMethod === 'initialize');
    const own = isInitialize ? declaredVersion(msg) : null;
    return own ?? sessionVersion ?? DEFAULT_PROTOCOL_VERSION;
}
