import type { CapturedMessage } from '@acp-devtools/core';

export type TimelineEntry =
    | { type: 'message'; message: CapturedMessage }
    | {
          type: 'stream-cluster';
          sessionId: string;
          messages: CapturedMessage[];
          firstSeq: number;
          lastSeq: number;
          combinedText: string;
          firstTimestamp: number;
          lastTimestamp: number;
      };

interface ChunkInfo {
    sessionId: string;
    text: string;
}

function chunkInfo(m: CapturedMessage): ChunkInfo | null {
    if (m.kind !== 'notification' || m.method !== 'session/update') return null;
    const payload = m.payload as unknown;
    if (!payload || typeof payload !== 'object') return null;
    const params = (payload as { params?: unknown }).params as
        | { sessionId?: string; update?: { sessionUpdate?: string; content?: { text?: string } } }
        | undefined;
    if (!params || params.update?.sessionUpdate !== 'agent_message_chunk') return null;
    return {
        sessionId: String(params.sessionId ?? ''),
        text: params.update?.content?.text ?? '',
    };
}

/**
 * Collapse runs of ≥2 consecutive `agent_message_chunk` notifications carrying
 * the same sessionId into a single cluster entry. Single chunks pass through
 * as plain messages so a one-off update is not hidden.
 */
export function groupTimeline(messages: CapturedMessage[]): TimelineEntry[] {
    const out: TimelineEntry[] = [];
    let pending: { sessionId: string; messages: CapturedMessage[]; text: string } | null = null;

    const flush = () => {
        if (!pending) return;
        if (pending.messages.length === 1) {
            const only = pending.messages[0]!;
            out.push({ type: 'message', message: only });
        } else {
            const first = pending.messages[0]!;
            const last = pending.messages[pending.messages.length - 1]!;
            out.push({
                type: 'stream-cluster',
                sessionId: pending.sessionId,
                messages: pending.messages,
                firstSeq: first.seq,
                lastSeq: last.seq,
                combinedText: pending.text,
                firstTimestamp: first.timestamp,
                lastTimestamp: last.timestamp,
            });
        }
        pending = null;
    };

    for (const m of messages) {
        const info = chunkInfo(m);
        if (info && pending && pending.sessionId === info.sessionId) {
            pending.messages.push(m);
            pending.text += info.text;
            continue;
        }
        flush();
        if (info) {
            pending = { sessionId: info.sessionId, messages: [m], text: info.text };
        } else {
            out.push({ type: 'message', message: m });
        }
    }
    flush();
    return out;
}
