import { beforeEach, describe, expect, it } from 'vitest';
import type { CapturedMessage } from '@acp-devtools/core';
import { groupTimeline } from './grouping';

let seqCounter = 0;
function chunk(sessionId: string, text: string): CapturedMessage {
    seqCounter += 1;
    return {
        seq: seqCounter,
        timestamp: 1_700_000_000_000 + seqCounter,
        direction: 'agent-to-editor',
        kind: 'notification',
        method: 'session/update',
        raw: '',
        payload: {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
            },
        } as unknown as CapturedMessage['payload'],
    };
}

function regular(method: string, kind: CapturedMessage['kind'] = 'request'): CapturedMessage {
    seqCounter += 1;
    return {
        seq: seqCounter,
        timestamp: 1_700_000_000_000 + seqCounter,
        direction: 'editor-to-agent',
        kind,
        method,
        raw: '',
        payload: { jsonrpc: '2.0', method } as unknown as CapturedMessage['payload'],
    };
}

describe('groupTimeline', () => {
    beforeEach(() => {
        seqCounter = 0;
    });

    it('returns plain messages when there are no chunks', () => {
        const out = groupTimeline([regular('initialize'), regular('session/new')]);
        expect(out).toHaveLength(2);
        expect(out.every((e) => e.type === 'message')).toBe(true);
    });

    it('does NOT cluster a single chunk', () => {
        const out = groupTimeline([regular('initialize'), chunk('s', 'Hi')]);
        expect(out.map((e) => e.type)).toEqual(['message', 'message']);
    });

    it('clusters two or more consecutive chunks of the same session', () => {
        const out = groupTimeline([
            regular('session/prompt'),
            chunk('s', 'Hi'),
            chunk('s', ' there'),
            chunk('s', '!'),
            regular('session/prompt'),
        ]);
        expect(out.map((e) => e.type)).toEqual(['message', 'stream-cluster', 'message']);
        const cluster = out[1]!;
        if (cluster.type !== 'stream-cluster') throw new Error('expected stream-cluster');
        expect(cluster.messages).toHaveLength(3);
        expect(cluster.combinedText).toBe('Hi there!');
        expect(cluster.sessionId).toBe('s');
    });

    it('breaks a cluster when a non-chunk message arrives mid-stream', () => {
        const out = groupTimeline([
            chunk('s', 'A'),
            chunk('s', 'B'),
            regular('session/request_permission', 'request'),
            chunk('s', 'C'),
            chunk('s', 'D'),
        ]);
        expect(out.map((e) => e.type)).toEqual([
            'stream-cluster',
            'message',
            'stream-cluster',
        ]);
    });

    it('breaks a cluster on a different sessionId', () => {
        const out = groupTimeline([
            chunk('alpha', 'A'),
            chunk('alpha', 'B'),
            chunk('bravo', 'X'),
            chunk('bravo', 'Y'),
        ]);
        expect(out.map((e) => e.type)).toEqual(['stream-cluster', 'stream-cluster']);
    });
});
