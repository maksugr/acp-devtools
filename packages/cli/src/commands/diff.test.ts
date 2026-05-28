import { describe, expect, it } from 'vitest';
import {
    buildMetadataDiff,
    buildMethodStatsDiff,
    buildSessionDiff,
    type CapturedMessage,
    type JsonRpcMessage,
    type SessionRecord,
} from '@acp-devtools/core';
import { headerJson, renderChange, renderDiff, renderInfoSection, renderPerfSection } from './diff.js';

/** renderDiff now also takes metadata + per-method deltas; compute them from
 *  the same frame arrays so tests exercise the real composition. */
function render(
    a: CapturedMessage[],
    b: CapturedMessage[],
    infoA: SessionRecord,
    infoB: SessionRecord,
    full = false,
): string {
    return renderDiff(
        infoA,
        infoB,
        a.length,
        b.length,
        buildSessionDiff(a, b),
        buildMetadataDiff(a, b),
        buildMethodStatsDiff(a, b),
        full,
    );
}

const info = (id: number, overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id,
    name: null,
    agentCommand: 'claude-code',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    clientName: 'Zed',
    importedAt: null,
    ...overrides,
});

let seq = 0;
const req = (method: string, params: unknown, overrides: Partial<CapturedMessage> = {}): CapturedMessage => {
    const s = overrides.seq ?? ++seq;
    const payload: JsonRpcMessage = { jsonrpc: '2.0', id: s, method, params };
    return {
        seq: s,
        timestamp: 1_700_000_000_000 + s * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method,
        rpcId: s,
        raw: JSON.stringify(payload),
        payload,
        ...overrides,
    };
};

describe('renderDiff', () => {
    it('prints a clean message when sessions are identical', () => {
        const a = [req('initialize', { v: 1 }, { seq: 1 })];
        const b = [req('initialize', { v: 1 }, { seq: 1 })];
        const out = render(a, b, info(1), info(2));
        expect(out).toContain('1 same');
        expect(out).toContain('sessions are identical');
    });

    it('shows the summary counts and collapses equal runs by default', () => {
        const a = [
            req('initialize', {}, { seq: 1 }),
            req('session/new', {}, { seq: 2 }),
            req('session/prompt', { text: 'old' }, { seq: 3 }),
        ];
        const b = [
            req('initialize', {}, { seq: 1 }),
            req('session/new', {}, { seq: 2 }),
            req('session/prompt', { text: 'new' }, { seq: 3 }),
        ];
        const out = render(a, b, info(1), info(2));
        expect(out).toContain('1 differs');
        expect(out).toContain('… 2 unchanged …');
        expect(out).toContain('≠ →A REQ session/prompt');
        // Field-level key changes stay +/−/~ — those ARE edits to one object.
        expect(out).toContain('~ params.text: "old" → "new"');
    });

    it('prints equal rows when full is set', () => {
        const a = [req('initialize', {}, { seq: 1 })];
        const b = [req('initialize', {}, { seq: 1 })];
        const out = render(a, b, info(1), info(2), true);
        expect(out).toContain('= →A REQ initialize');
        expect(out).not.toContain('unchanged');
    });

    it('marks added and removed frames with their seq refs', () => {
        const a = [req('initialize', {}, { seq: 1 }), req('only/a', {}, { seq: 2 })];
        const b = [req('initialize', {}, { seq: 1 }), req('only/b', {}, { seq: 2 })];
        const out = render(a, b, info(1), info(2));
        expect(out).toMatch(/◂ →A REQ only\/a\s+a#2\s+b#—/);
        expect(out).toMatch(/▸ →A REQ only\/b\s+a#—\s+b#2/);
    });

    it('renders the session header labels', () => {
        const out = render([], [], info(5, { clientName: 'WebStorm', agentCommand: 'goose' }), info(6));
        expect(out).toContain('A #5  WebStorm · goose');
        expect(out).toContain('diff  #5  →  #6');
    });
});

describe('renderInfoSection / renderPerfSection', () => {
    it('reports identical metadata when there are no changes', () => {
        const a = [req('initialize', { protocolVersion: 1 }, { seq: 1 })];
        const out = renderInfoSection(buildMetadataDiff(a, a));
        expect(out).toContain('INFO');
        expect(out).toContain('metadata identical');
    });

    it('surfaces a per-method p99 delta in the perf table', () => {
        const a = [
            req('session/prompt', {}, { seq: 1, rpcId: 1 }),
            req('', {}, { seq: 2, rpcId: 1, kind: 'response', method: undefined, timestamp: 1_700_000_000_000 + 1000 }),
        ];
        const b = [
            req('session/prompt', {}, { seq: 1, rpcId: 1 }),
            req('', {}, { seq: 2, rpcId: 1, kind: 'response', method: undefined, timestamp: 1_700_000_000_000 + 3000 }),
        ];
        const out = renderPerfSection(buildMethodStatsDiff(a, b));
        expect(out).toContain('PERF');
        expect(out).toContain('session/prompt');
        expect(out).toMatch(/Δ p99/);
    });
});

describe('headerJson (--json header shape)', () => {
    it('emits id, message count, and a client·agent label', () => {
        expect(headerJson(info(7, { clientName: 'WebStorm', agentCommand: 'goose' }), 12)).toEqual({
            id: 7,
            label: 'WebStorm · goose',
            messageCount: 12,
        });
    });

    it('falls back to the session name when client/agent are absent', () => {
        expect(
            headerJson(info(8, { clientName: null, agentCommand: null, name: 'capture.json' }), 3),
        ).toEqual({ id: 8, label: 'capture.json', messageCount: 3 });
    });

    it('falls back to em dash when nothing identifies the session', () => {
        expect(headerJson(info(9, { clientName: null, agentCommand: null, name: null }), 0)).toEqual(
            { id: 9, label: '—', messageCount: 0 },
        );
    });
});

describe('renderChange', () => {
    it('formats add / remove / change', () => {
        expect(renderChange({ path: 'params.x', kind: 'add', b: 1 })).toBe('+ params.x: 1');
        expect(renderChange({ path: 'params.y', kind: 'remove', a: 'z' })).toBe('- params.y: "z"');
        expect(renderChange({ path: 'params.z', kind: 'change', a: 1, b: 2 })).toBe(
            '~ params.z: 1 → 2',
        );
    });

    it('truncates long values', () => {
        const long = 'x'.repeat(200);
        const out = renderChange({ path: 'p', kind: 'add', b: long });
        expect(out.length).toBeLessThan(80);
        expect(out).toContain('…');
    });
});
