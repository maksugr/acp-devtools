import { describe, expect, it } from 'vitest';
import type { CapturedMessage, JsonRpcMessage } from './types.js';
import { buildSessionDiff } from './session-diff.js';

let seqCounter = 0;

const mk = (overrides: Partial<CapturedMessage> = {}): CapturedMessage => {
    const seq = overrides.seq ?? ++seqCounter;
    const base: CapturedMessage = {
        seq,
        timestamp: 1_700_000_000_000 + seq * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{}',
        payload: null,
    };
    return { ...base, ...overrides };
};

/** Request with a parsed payload so payload diffing has something to chew on. */
const req = (
    method: string,
    params: unknown,
    overrides: Partial<CapturedMessage> = {},
): CapturedMessage => {
    const payload: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: overrides.rpcId ?? overrides.seq ?? ++seqCounter,
        method,
        params,
    };
    return mk({
        method,
        kind: 'request',
        payload,
        raw: JSON.stringify(payload),
        ...overrides,
    });
};

const resp = (
    result: unknown,
    overrides: Partial<CapturedMessage> = {},
): CapturedMessage => {
    const payload: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: overrides.rpcId ?? overrides.seq ?? ++seqCounter,
        result,
    };
    return mk({
        method: undefined,
        kind: 'response',
        direction: 'agent-to-editor',
        payload,
        raw: JSON.stringify(payload),
        ...overrides,
    });
};

describe('buildSessionDiff', () => {
    it('marks two identical sessions as all-equal', () => {
        const a = [req('initialize', { protocolVersion: 1 }, { seq: 1, rpcId: 'x' })];
        const b = [req('initialize', { protocolVersion: 1 }, { seq: 1, rpcId: 'y' })];
        const diff = buildSessionDiff(a, b);
        expect(diff.summary).toEqual({ equal: 1, changed: 0, added: 0, removed: 0, total: 1 });
        expect(diff.rows[0]!.op).toBe('equal');
        expect(diff.rows[0]!.changes).toEqual([]);
    });

    it('ignores the volatile rpcId — same payload, different id is still equal', () => {
        const a = [req('session/prompt', { text: 'hi' }, { seq: 1, rpcId: 1 })];
        const b = [req('session/prompt', { text: 'hi' }, { seq: 1, rpcId: 9999 })];
        expect(buildSessionDiff(a, b).rows[0]!.op).toBe('equal');
    });

    it('classifies a payload difference as changed with a field-level path', () => {
        const a = [req('session/prompt', { cwd: '/a', model: 'sonnet' }, { seq: 1 })];
        const b = [req('session/prompt', { cwd: '/b', model: 'sonnet' }, { seq: 1 })];
        const diff = buildSessionDiff(a, b);
        expect(diff.summary.changed).toBe(1);
        const row = diff.rows[0]!;
        expect(row.op).toBe('changed');
        expect(row.changes).toEqual([{ path: 'params.cwd', kind: 'change', a: '/a', b: '/b' }]);
    });

    it('detects added and removed object keys', () => {
        const a = [req('initialize', { onlyA: true, shared: 1 }, { seq: 1 })];
        const b = [req('initialize', { shared: 1, onlyB: 'x' }, { seq: 1 })];
        const row = buildSessionDiff(a, b).rows[0]!;
        expect(row.op).toBe('changed');
        expect(row.changes).toContainEqual({ path: 'params.onlyA', kind: 'remove', a: true });
        expect(row.changes).toContainEqual({ path: 'params.onlyB', kind: 'add', b: 'x' });
    });

    it('reports array element changes with bracketed indices', () => {
        const a = [req('x', { items: [1, 2, 3] }, { seq: 1 })];
        const b = [req('x', { items: [1, 9] }, { seq: 1 })];
        const row = buildSessionDiff(a, b).rows[0]!;
        expect(row.changes).toContainEqual({ path: 'params.items[1]', kind: 'change', a: 2, b: 9 });
        expect(row.changes).toContainEqual({ path: 'params.items[2]', kind: 'remove', a: 3 });
    });

    it('flags a frame only in B as added, only in A as removed', () => {
        const a = [req('initialize', {}, { seq: 1 }), req('session/new', {}, { seq: 2 })];
        const b = [
            req('initialize', {}, { seq: 1 }),
            req('session/load', {}, { seq: 2 }),
            req('session/new', {}, { seq: 3 }),
        ];
        const diff = buildSessionDiff(a, b);
        // initialize equal, session/load added, session/new equal
        expect(diff.summary.added).toBe(1);
        expect(diff.summary.equal).toBe(2);
        const added = diff.rows.find((r) => r.op === 'added')!;
        expect(added.b!.method).toBe('session/load');
        expect(added.a).toBeNull();
    });

    it('preserves arrival order in the aligned row list', () => {
        const a = [req('a', {}, { seq: 1 }), req('b', {}, { seq: 2 }), req('c', {}, { seq: 3 })];
        const b = [req('a', {}, { seq: 1 }), req('c', {}, { seq: 2 })];
        const methods = buildSessionDiff(a, b).rows.map((r) => (r.a ?? r.b)!.method);
        expect(methods).toEqual(['a', 'b', 'c']);
    });

    it('aligns responses by their paired request method, not by id', () => {
        const a = [
            req('session/prompt', {}, { seq: 1, rpcId: 1 }),
            resp({ stopReason: 'end_turn' }, { seq: 2, rpcId: 1 }),
        ];
        const b = [
            req('session/prompt', {}, { seq: 1, rpcId: 50 }),
            resp({ stopReason: 'cancelled' }, { seq: 2, rpcId: 50 }),
        ];
        const diff = buildSessionDiff(a, b);
        // request equal, response changed (stopReason differs) — not added/removed.
        expect(diff.summary.added).toBe(0);
        expect(diff.summary.removed).toBe(0);
        const respRow = diff.rows.find((r) => r.a?.kind === 'response')!;
        expect(respRow.op).toBe('changed');
        expect(respRow.changes).toContainEqual({
            path: 'result.stopReason',
            kind: 'change',
            a: 'end_turn',
            b: 'cancelled',
        });
    });

    it('caps field-level changes at maxChangesPerRow', () => {
        const big = (offset: number) =>
            Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i + offset]));
        const a = [req('x', big(0), { seq: 1 })];
        const b = [req('x', big(1000), { seq: 1 })];
        const row = buildSessionDiff(a, b, { maxChangesPerRow: 5 }).rows[0]!;
        expect(row.op).toBe('changed');
        expect(row.changes.length).toBe(5);
    });

    it('handles two empty sessions', () => {
        expect(buildSessionDiff([], []).summary).toEqual({
            equal: 0,
            changed: 0,
            added: 0,
            removed: 0,
            total: 0,
        });
    });

    it('treats everything as added when A is empty', () => {
        const b = [req('initialize', {}, { seq: 1 }), req('session/new', {}, { seq: 2 })];
        const diff = buildSessionDiff([], b);
        expect(diff.summary.added).toBe(2);
        expect(diff.rows.every((r) => r.op === 'added')).toBe(true);
    });

    it('diffs parse-failed frames by raw bytes', () => {
        const a = [mk({ seq: 1, kind: 'unknown', method: undefined, payload: null, raw: 'broken-A', parseError: 'x' })];
        const b = [mk({ seq: 1, kind: 'unknown', method: undefined, payload: null, raw: 'broken-B', parseError: 'x' })];
        const row = buildSessionDiff(a, b).rows[0]!;
        expect(row.op).toBe('changed');
        expect(row.changes).toContainEqual({ path: 'raw', kind: 'change', a: 'broken-A', b: 'broken-B' });
    });
});
