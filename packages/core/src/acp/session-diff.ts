import type { CapturedMessage } from './types.js';
import { buildPairIndex } from './method-stats.js';

export type DiffOp = 'equal' | 'changed' | 'added' | 'removed';

export interface JsonChange {
    /** Dotted/bracketed path into the payload, e.g. `params.cwd` or `result.modes[1].id`. */
    path: string;
    kind: 'add' | 'remove' | 'change';
    /** Value on the A (baseline) side. Absent for `add`. */
    a?: unknown;
    /** Value on the B (new) side. Absent for `remove`. */
    b?: unknown;
}

export interface DiffRow {
    op: DiffOp;
    /** Frame from session A (baseline). null for `added`. */
    a: CapturedMessage | null;
    /** Frame from session B (new). null for `removed`. */
    b: CapturedMessage | null;
    /** Alignment signature both sides shared (the lone side's, for added/removed). */
    signature: string;
    /** Field-level payload changes. Non-empty only for `changed`. */
    changes: JsonChange[];
}

export interface DiffSummary {
    equal: number;
    changed: number;
    added: number;
    removed: number;
    /** Total aligned rows. */
    total: number;
}

export interface SessionDiff {
    rows: DiffRow[];
    summary: DiffSummary;
}

export interface SessionDiffOptions {
    /** Cap on field-level changes recorded per changed row (default 100). */
    maxChangesPerRow?: number;
}

const DEFAULT_MAX_CHANGES = 100;

/**
 * Align two captured sessions and classify every frame as equal / changed /
 * added / removed.
 *
 * Alignment is an LCS over a per-frame **signature** — `direction | kind |
 * method` — which is stable across captures (rpcId and timestamp are volatile
 * and deliberately excluded). For responses and errors, which carry no
 * `method` of their own, the method is resolved from the paired request via
 * {@link buildPairIndex} so a `session/prompt` response on each side aligns by
 * its method, not by a meaningless id.
 *
 * Matched frames are then compared field-by-field on a normalized payload (the
 * JSON-RPC envelope minus the volatile `id`/`jsonrpc`) → `equal` when no
 * differences, `changed` with a `changes[]` list otherwise.
 *
 * A is the baseline (left), B is the new side (right): `removed` rows exist
 * only in A, `added` rows only in B.
 *
 * Single source of truth — CLI (`acp-devtools diff`), the `diff_sessions` MCP
 * tool, and the UI DiffPanel all read alignment through this function.
 *
 * Complexity is O(|A|·|B|) time and memory for the LCS table; the largest real
 * captures (~1.4k frames) stay well under a megabyte, but pathological 10k×10k
 * diffs are not the target workload.
 */
export function buildSessionDiff(
    a: CapturedMessage[],
    b: CapturedMessage[],
    options: SessionDiffOptions = {},
): SessionDiff {
    const maxChanges = options.maxChangesPerRow ?? DEFAULT_MAX_CHANGES;
    const sigA = signatures(a);
    const sigB = signatures(b);

    const ops = lcsAlign(sigA, sigB);

    const rows: DiffRow[] = [];
    const summary: DiffSummary = { equal: 0, changed: 0, added: 0, removed: 0, total: 0 };

    for (const step of ops) {
        if (step.kind === 'match') {
            const ma = a[step.i]!;
            const mb = b[step.j]!;
            const changes = diffPayloads(ma, mb, maxChanges);
            const op: DiffOp = changes.length === 0 ? 'equal' : 'changed';
            rows.push({ op, a: ma, b: mb, signature: sigA[step.i]!, changes });
            if (op === 'equal') summary.equal += 1;
            else summary.changed += 1;
        } else if (step.kind === 'removed') {
            const ma = a[step.i]!;
            rows.push({ op: 'removed', a: ma, b: null, signature: sigA[step.i]!, changes: [] });
            summary.removed += 1;
        } else {
            const mb = b[step.j]!;
            rows.push({ op: 'added', a: null, b: mb, signature: sigB[step.j]!, changes: [] });
            summary.added += 1;
        }
    }
    summary.total = rows.length;
    return { rows, summary };
}

function signatures(messages: CapturedMessage[]): string[] {
    const pairs = buildPairIndex(messages);
    const seqToMethod = new Map<number, string>();
    for (const m of messages) if (m.method) seqToMethod.set(m.seq, m.method);
    return messages.map((m) => {
        let method = m.method ?? '';
        if (!method && (m.kind === 'response' || m.kind === 'error')) {
            const pair = pairs.get(m.seq);
            if (pair) method = seqToMethod.get(pair.pairSeq) ?? '';
        }
        return `${m.direction}|${m.kind}|${method}`;
    });
}

type AlignStep =
    | { kind: 'match'; i: number; j: number }
    | { kind: 'removed'; i: number }
    | { kind: 'added'; j: number };

/**
 * Classic LCS dynamic program over two signature arrays, returning an ordered
 * alignment. Matches preserve relative order; non-matched entries become
 * removed (A-only) or added (B-only).
 */
function lcsAlign(a: string[], b: string[]): AlignStep[] {
    const n = a.length;
    const m = b.length;
    const width = m + 1;
    // dp[i*width + j] = LCS length of a[i:] and b[j:].
    const dp = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            const idx = i * width + j;
            if (a[i] === b[j]) {
                dp[idx] = dp[(i + 1) * width + (j + 1)]! + 1;
            } else {
                const down = dp[(i + 1) * width + j]!;
                const right = dp[i * width + (j + 1)]!;
                dp[idx] = down >= right ? down : right;
            }
        }
    }

    const steps: AlignStep[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            steps.push({ kind: 'match', i, j });
            i++;
            j++;
        } else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
            steps.push({ kind: 'removed', i });
            i++;
        } else {
            steps.push({ kind: 'added', j });
            j++;
        }
    }
    while (i < n) {
        steps.push({ kind: 'removed', i });
        i++;
    }
    while (j < m) {
        steps.push({ kind: 'added', j });
        j++;
    }
    return steps;
}

/**
 * Reduce a frame to the part worth comparing: the JSON-RPC method and payload
 * body, dropping the volatile `id` and the constant `jsonrpc`. Parse-failed
 * frames fall back to their raw bytes so a malformed line still diffs.
 */
function comparable(m: CapturedMessage): unknown {
    const p = m.payload;
    if (p === null || typeof p !== 'object') {
        return { raw: m.raw, parseError: m.parseError ?? null };
    }
    const obj = p as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if ('method' in obj) out.method = obj.method;
    if ('params' in obj) out.params = obj.params;
    if ('result' in obj) out.result = obj.result;
    if ('error' in obj) out.error = obj.error;
    return out;
}

function diffPayloads(a: CapturedMessage, b: CapturedMessage, max: number): JsonChange[] {
    const out: JsonChange[] = [];
    deepDiff(comparable(a), comparable(b), '', out, max);
    return out;
}

/**
 * Field-level diff of two arbitrary JSON values, reusing the same recursive
 * walker as payload diffing. Used by `session-compare` for metadata diffs.
 */
export function diffJson(a: unknown, b: unknown, maxChanges: number = DEFAULT_MAX_CHANGES): JsonChange[] {
    const out: JsonChange[] = [];
    deepDiff(a, b, '', out, maxChanges);
    return out;
}

type ValueShape = 'array' | 'object' | 'leaf';

function shapeOf(value: unknown): ValueShape {
    if (Array.isArray(value)) return 'array';
    if (value !== null && typeof value === 'object') return 'object';
    return 'leaf';
}

function deepDiff(a: unknown, b: unknown, path: string, out: JsonChange[], max: number): void {
    if (out.length >= max) return;
    if (Object.is(a, b)) return;

    const sa = shapeOf(a);
    const sb = shapeOf(b);

    if (sa !== sb || sa === 'leaf') {
        if (leafEqual(a, b)) return;
        out.push({ path: path || '$', kind: 'change', a, b });
        return;
    }

    if (sa === 'array') {
        const arrA = a as unknown[];
        const arrB = b as unknown[];
        const n = Math.max(arrA.length, arrB.length);
        for (let i = 0; i < n; i++) {
            if (out.length >= max) return;
            const childPath = `${path}[${i}]`;
            const inA = i < arrA.length;
            const inB = i < arrB.length;
            if (inA && inB) deepDiff(arrA[i], arrB[i], childPath, out, max);
            else if (inB) out.push({ path: childPath, kind: 'add', b: arrB[i] });
            else out.push({ path: childPath, kind: 'remove', a: arrA[i] });
        }
        return;
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(objA), ...Object.keys(objB)])].sort();
    for (const k of keys) {
        if (out.length >= max) return;
        const childPath = path ? `${path}.${k}` : k;
        const inA = k in objA;
        const inB = k in objB;
        if (inA && inB) deepDiff(objA[k], objB[k], childPath, out, max);
        else if (inB) out.push({ path: childPath, kind: 'add', b: objB[k] });
        else out.push({ path: childPath, kind: 'remove', a: objA[k] });
    }
}

function leafEqual(a: unknown, b: unknown): boolean {
    return Object.is(a, b);
}
