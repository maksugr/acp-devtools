import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from '../acp/types.js';
import { PlaybackEngine, extractRpcId, substituteRpcId } from './playback.js';

function mk(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    const base: CapturedMessage = {
        seq,
        timestamp: seq * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: JSON.stringify({ jsonrpc: '2.0', id: seq, method: 'initialize', params: {} }),
        payload: { jsonrpc: '2.0', id: seq, method: 'initialize', params: {} },
    };
    return { ...base, ...overrides };
}

describe('extractRpcId', () => {
    it('returns the numeric id from a request', () => {
        expect(extractRpcId('{"jsonrpc":"2.0","id":42,"method":"x"}')).toBe(42);
    });
    it('returns the string id from a UUID request', () => {
        expect(extractRpcId('{"jsonrpc":"2.0","id":"abc-1","method":"x"}')).toBe('abc-1');
    });
    it('returns undefined for notifications', () => {
        expect(extractRpcId('{"jsonrpc":"2.0","method":"x","params":{}}')).toBeUndefined();
    });
    it('returns undefined for unparseable input', () => {
        expect(extractRpcId('{junk')).toBeUndefined();
    });
});

describe('substituteRpcId', () => {
    it('rewrites the id field while keeping the rest of the payload', () => {
        const msg = mk(2, {
            kind: 'response',
            method: undefined,
            direction: 'agent-to-editor',
            rpcId: 2,
            payload: { jsonrpc: '2.0', id: 2, result: { ok: true } },
            raw: '{"jsonrpc":"2.0","id":2,"result":{"ok":true}}',
        });
        const out = substituteRpcId(msg, 99);
        const parsed = JSON.parse(out);
        expect(parsed).toEqual({ jsonrpc: '2.0', id: 99, result: { ok: true } });
    });
    it('falls back to raw when payload is null (parse error case)', () => {
        const msg = mk(1, { payload: null, raw: '{junk', parseError: 'oops' });
        expect(substituteRpcId(msg, 99)).toBe('{junk');
    });
});

describe('PlaybackEngine — mock-agent role', () => {
    function build(): PlaybackEngine {
        const script: CapturedMessage[] = [
            // editor → agent: initialize req (id=1)
            mk(1, {
                direction: 'editor-to-agent',
                kind: 'request',
                method: 'initialize',
                rpcId: 1,
                raw: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
                payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
            }),
            // agent → editor: initialize rsp (id=1)
            mk(2, {
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
                raw: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}',
                payload: { jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } },
            }),
            // agent → editor: session/update notification
            mk(3, {
                direction: 'agent-to-editor',
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                raw: '{"jsonrpc":"2.0","method":"session/update","params":{}}',
                payload: { jsonrpc: '2.0', method: 'session/update', params: {} },
            }),
            // editor → agent: prompt (id=2)
            mk(4, {
                direction: 'editor-to-agent',
                kind: 'request',
                method: 'session/prompt',
                rpcId: 2,
                raw: '{"jsonrpc":"2.0","id":2,"method":"session/prompt"}',
                payload: { jsonrpc: '2.0', id: 2, method: 'session/prompt' },
            }),
            // agent → editor: prompt response (id=2)
            mk(5, {
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 2,
                raw: '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}',
                payload: { jsonrpc: '2.0', id: 2, result: { stopReason: 'end_turn' } },
            }),
        ];
        return new PlaybackEngine(script, 'agent');
    }

    it('starts by waiting for the editor', () => {
        const e = build();
        const step = e.next();
        expect(step.kind).toBe('wait');
        if (step.kind === 'wait') expect(step.expected.method).toBe('initialize');
    });

    it('reports deltaSincePrevMs on emit steps for --realtime callers', () => {
        const script: CapturedMessage[] = [
            mk(1, { direction: 'editor-to-agent', kind: 'request', rpcId: 1, timestamp: 1000 }),
            mk(2, {
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
                timestamp: 1500,
            }),
            mk(3, {
                direction: 'agent-to-editor',
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                timestamp: 1510,
            }),
        ];
        const e = new PlaybackEngine(script, 'agent');
        e.next(); // wait
        e.onIncoming('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
        const a = e.next();
        expect(a.kind).toBe('emit');
        if (a.kind === 'emit') expect(a.deltaSincePrevMs).toBe(500); // 1500 - 1000
        const b = e.next();
        expect(b.kind).toBe('emit');
        if (b.kind === 'emit') expect(b.deltaSincePrevMs).toBe(10); // 1510 - 1500
    });

    it('clamps negative deltas (clock skew) to zero', () => {
        const script: CapturedMessage[] = [
            mk(1, { direction: 'editor-to-agent', kind: 'request', rpcId: 1, timestamp: 2000 }),
            mk(2, {
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
                timestamp: 1500, // earlier than prev
            }),
        ];
        const e = new PlaybackEngine(script, 'agent');
        e.next();
        e.onIncoming('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
        const step = e.next();
        if (step.kind === 'emit') expect(step.deltaSincePrevMs).toBe(0);
    });

    it('after receiving the editor request, emits a response with the wire-side id', () => {
        const e = build();
        e.next(); // wait
        // Real editor sends with id="abc-uuid"
        const consumed = e.onIncoming('{"jsonrpc":"2.0","id":"abc-uuid","method":"initialize"}');
        expect(consumed).toBe(true);

        const step = e.next();
        expect(step.kind).toBe('emit');
        if (step.kind === 'emit') {
            const parsed = JSON.parse(step.line);
            // id swapped from script's 1 to wire's "abc-uuid"
            expect(parsed.id).toBe('abc-uuid');
            expect(parsed.result.protocolVersion).toBe(1);
        }
    });

    it('emits notifications without waiting (they have no id to map)', () => {
        const e = build();
        e.next(); // wait
        e.onIncoming('{"jsonrpc":"2.0","id":99,"method":"initialize"}');
        e.next(); // emit response
        // Next should be notification, still our turn
        const step = e.next();
        expect(step.kind).toBe('emit');
        if (step.kind === 'emit') {
            expect(step.message.method).toBe('session/update');
        }
    });

    it('returns done after all messages have been emitted/consumed', () => {
        const e = build();
        const walk = () => {
            let safety = 30;
            while (safety-- > 0) {
                const step = e.next();
                if (step.kind === 'wait') {
                    e.onIncoming('{"jsonrpc":"2.0","id":99,"method":"x"}');
                    continue;
                }
                if (step.kind === 'done') return;
            }
            throw new Error('did not reach done');
        };
        walk();
        expect(e.exhausted).toBe(true);
    });
});

describe('PlaybackEngine — mock-editor role (editor side)', () => {
    it('emits the editor request first, then waits for the agent', () => {
        const script: CapturedMessage[] = [
            mk(1, {
                direction: 'editor-to-agent',
                kind: 'request',
                method: 'initialize',
                rpcId: 1,
            }),
            mk(2, {
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
            }),
        ];
        const e = new PlaybackEngine(script, 'editor');
        const a = e.next();
        expect(a.kind).toBe('emit');
        const b = e.next();
        expect(b.kind).toBe('wait');
    });
});
