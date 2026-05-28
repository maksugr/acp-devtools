import { describe, expect, it } from 'vitest';
import type { CapturedMessage, JsonRpcMessage } from './types.js';
import { buildMetadataDiff, buildMethodStatsDiff } from './session-compare.js';

let seq = 0;
const mk = (overrides: Partial<CapturedMessage> & { payload: JsonRpcMessage }): CapturedMessage => {
    const s = overrides.seq ?? ++seq;
    return {
        seq: s,
        timestamp: 1_700_000_000_000 + s * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        rpcId: s,
        raw: JSON.stringify(overrides.payload),
        ...overrides,
    };
};

function initialize(client: { name: string; title: string; version: string }): CapturedMessage {
    return mk({
        method: 'initialize',
        kind: 'request',
        payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: 1,
                clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
                clientInfo: client,
            },
        },
    });
}
function initResponse(caps: Record<string, unknown>): CapturedMessage {
    return mk({
        method: undefined,
        kind: 'response',
        direction: 'agent-to-editor',
        rpcId: 1,
        payload: {
            jsonrpc: '2.0',
            id: 1,
            result: {
                protocolVersion: 1,
                agentCapabilities: caps,
                agentInfo: { name: 'mock', title: 'Mock', version: '1.0' },
            },
        },
    });
}
function prompt(seqNum: number, rpcId: number): CapturedMessage {
    return mk({
        seq: seqNum,
        method: 'session/prompt',
        kind: 'request',
        rpcId,
        payload: { jsonrpc: '2.0', id: rpcId, method: 'session/prompt', params: {} },
    });
}
function response(seqNum: number, rpcId: number, ts: number): CapturedMessage {
    return mk({
        seq: seqNum,
        method: undefined,
        kind: 'response',
        direction: 'agent-to-editor',
        rpcId,
        timestamp: ts,
        payload: { jsonrpc: '2.0', id: rpcId, result: {} },
    });
}

describe('buildMetadataDiff', () => {
    it('flags client identity and capability differences', () => {
        const a = [
            initialize({ name: 'webstorm', title: 'WebStorm', version: '2026.1' }),
            initResponse({ promptCapabilities: {}, loadSession: true }),
        ];
        const b = [
            initialize({ name: 'zed', title: 'Zed', version: '1.0' }),
            initResponse({ promptCapabilities: {} }), // loadSession dropped
        ];
        const diff = buildMetadataDiff(a, b);
        const paths = diff.changes.map((c) => c.path);
        expect(paths.some((p) => p.includes('client.title'))).toBe(true);
        // The dropped agent capability shows up as a change/removal.
        expect(diff.changes.some((c) => c.path.includes('loadSession'))).toBe(true);
    });

    it('reports no changes for metadata-identical sessions', () => {
        const frames = () => [
            initialize({ name: 'zed', title: 'Zed', version: '1.0' }),
            initResponse({ promptCapabilities: {} }),
        ];
        expect(buildMetadataDiff(frames(), frames()).changes).toEqual([]);
    });
});

describe('buildMethodStatsDiff', () => {
    it('computes per-method latency deltas and joins by method', () => {
        // prompt(seq 1) is timestamped base+1000 by the mk helper, so the
        // response timestamps below give 1000ms (A) and 3000ms (B) latency.
        const a = [
            prompt(1, 1),
            response(2, 1, 1_700_000_000_000 + 2000),
        ];
        const b = [
            prompt(1, 1),
            response(2, 1, 1_700_000_000_000 + 4000),
        ];
        const deltas = buildMethodStatsDiff(a, b);
        const promptDelta = deltas.find((d) => d.method === 'session/prompt');
        expect(promptDelta).toBeDefined();
        expect(promptDelta!.a!.p99).toBe(1000);
        expect(promptDelta!.b!.p99).toBe(3000);
        expect(promptDelta!.p99Delta).toBe(2000);
        expect(promptDelta!.countDelta).toBe(0);
    });

    it('marks a method present only on one side', () => {
        const a = [prompt(1, 1), response(2, 1, 1_700_000_000_500)];
        const b: CapturedMessage[] = [];
        const deltas = buildMethodStatsDiff(a, b);
        const d = deltas.find((x) => x.method === 'session/prompt')!;
        expect(d.a).not.toBeNull();
        expect(d.b).toBeNull();
        expect(d.countDelta).toBe(-1);
        expect(d.p99Delta).toBeNull(); // no B sample → null delta
    });
});
