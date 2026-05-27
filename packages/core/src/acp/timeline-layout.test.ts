import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { buildTimelineLayout } from './timeline-layout.js';

const mk = (overrides: Partial<CapturedMessage> & { seq: number }): CapturedMessage => ({
    timestamp: 1_700_000_000_000 + overrides.seq * 100,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: String(overrides.seq),
    raw: '{}',
    payload: null,
    ...overrides,
});

describe('buildTimelineLayout', () => {
    it('returns an empty layout for no messages', () => {
        const out = buildTimelineLayout([]);
        expect(out.events).toEqual([]);
        expect(out.durationMs).toBe(0);
    });

    it('assigns paired request/response as a single event extending to response timestamp', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, method: 'session/prompt', rpcId: 'a' }),
            mk({
                seq: 2,
                rpcId: 'a',
                kind: 'response',
                direction: 'agent-to-editor',
                timestamp: 1_700_000_000_500,
                method: undefined,
            }),
        ];
        const out = buildTimelineLayout(messages);
        expect(out.events).toHaveLength(1);
        const ev = out.events[0]!;
        expect(ev.seq).toBe(1);
        expect(ev.startTs).toBe(1_700_000_000_100);
        expect(ev.endTs).toBe(1_700_000_000_500);
        expect(ev.pairedSeq).toBe(2);
        expect(ev.erroredOut).toBe(false);
        expect(ev.lane).toBe('editor-req');
    });

    it('marks erroredOut when the paired counterpart is kind=error', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, method: 'session/load', rpcId: 'b' }),
            mk({
                seq: 2,
                rpcId: 'b',
                kind: 'error',
                direction: 'agent-to-editor',
                method: undefined,
            }),
        ];
        const out = buildTimelineLayout(messages);
        expect(out.events[0]?.erroredOut).toBe(true);
    });

    it('keeps unpaired requests as zero-width ticks (endTs equals startTs)', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, method: 'session/prompt', rpcId: 'lonely' }),
        ];
        const out = buildTimelineLayout(messages);
        const ev = out.events[0]!;
        expect(ev.startTs).toBe(ev.endTs);
        expect(ev.pairedSeq).toBeNull();
    });

    it('puts notifications into their own lane with zero-width events', () => {
        const messages: CapturedMessage[] = [
            mk({
                seq: 1,
                kind: 'notification',
                method: 'session/update',
                direction: 'agent-to-editor',
                rpcId: undefined,
            }),
        ];
        const out = buildTimelineLayout(messages);
        expect(out.events[0]?.lane).toBe('notification');
        expect(out.laneCounts.notification).toBe(1);
    });

    it('routes agent→editor requests into the agent-req lane', () => {
        const messages: CapturedMessage[] = [
            mk({
                seq: 1,
                direction: 'agent-to-editor',
                method: 'session/request_permission',
            }),
        ];
        const out = buildTimelineLayout(messages);
        expect(out.events[0]?.lane).toBe('agent-req');
        expect(out.laneCounts['agent-req']).toBe(1);
    });

    it('computes startTs / endTs / durationMs across the full session', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, timestamp: 1000 }),
            mk({ seq: 2, timestamp: 5000, rpcId: 'pair', method: 'session/prompt' }),
            mk({
                seq: 3,
                timestamp: 9000,
                rpcId: 'pair',
                kind: 'response',
                direction: 'agent-to-editor',
                method: undefined,
            }),
        ];
        const out = buildTimelineLayout(messages);
        expect(out.startTs).toBe(1000);
        // endTs extends to the response's timestamp, even though the bare
        // message's max timestamp would be 9000 — they're equal here, but the
        // helper would still extend if a request's response landed later.
        expect(out.endTs).toBe(9000);
        expect(out.durationMs).toBe(8000);
    });
});
