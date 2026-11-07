// @vitest-environment node
//
// Golden tests: run every analysis acp-devtools performs over every fixture
// session — real agent captures and the generated demo sessions — and compare
// the result with a committed snapshot in `__golden__/`. Any change in what the
// tools report for real traffic shows up as a snapshot diff in review.
//
// After an intended change, regenerate with `npx vitest run -u` and review the
// diff in `__golden__/` before committing it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactMessage } from '../storage/redact.js';
import { buildPairIndex, buildPerMethodStats } from './method-stats.js';
import { buildPerformanceInsights } from './perf-insights.js';
import { extractSessionMetadata } from './session-metadata.js';
import { resolveSpecForMessage } from './spec-decoder.js';
import { extractTextPreview, isUserPrompt } from './text.js';
import type { CapturedMessage } from './types.js';
import { validateAcpMessage, type ValidationResult } from './validate.js';

const FIXTURES = join(process.cwd(), 'fixtures');
const PREVIEW_FRAMES = 150;

interface Fixture {
    name: string;
    messages: CapturedMessage[];
}

function loadFixtures(): Fixture[] {
    const out: Fixture[] = [];
    const handshakes = join(FIXTURES, 'handshakes');
    for (const file of readdirSync(handshakes)
        .filter((f) => f.endsWith('.json'))
        .sort()) {
        const exp = JSON.parse(readFileSync(join(handshakes, file), 'utf8')) as {
            messages: CapturedMessage[];
        };
        out.push({ name: `handshakes/${file.replace(/\.json$/, '')}`, messages: exp.messages });
    }
    for (const file of readdirSync(FIXTURES)
        .filter((f) => /^generate-.*\.mjs$/.test(f))
        .sort()) {
        const json = execFileSync(process.execPath, [join(FIXTURES, file)], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const exp = JSON.parse(json) as { messages: CapturedMessage[] };
        out.push({ name: file.replace(/\.mjs$/, ''), messages: exp.messages });
    }
    return out;
}

/** Validation the way the product runs it: each response with its request's method. */
function validateSession(messages: CapturedMessage[]): Map<number, ValidationResult> {
    const pairs = buildPairIndex(messages);
    const methodBySeq = new Map(messages.map((m) => [m.seq, m.method]));
    const out = new Map<number, ValidationResult>();
    for (const m of messages) {
        const pair = pairs.get(m.seq);
        const pairedMethod = pair ? methodBySeq.get(pair.pairSeq) : undefined;
        out.set(m.seq, validateAcpMessage(m, pairedMethod ? { pairedMethod } : {}));
    }
    return out;
}

/**
 * Validation outcome per frame, with frames that share the same outcome
 * (schema, errors, advisories or skip reason) grouped: synthetic fixtures
 * repeat one shape hundreds of times. A frame moving to another group, or a
 * group's errors changing, both show up in the diff.
 */
function validationReport(messages: CapturedMessage[]) {
    const results = validateSession(messages);
    const summary = {
        checked: 0,
        valid: 0,
        invalid: 0,
        advisories: 0,
        skipped: {} as Record<string, number>,
    };
    const groups = new Map<string, { outcome: Record<string, unknown>; seqs: number[] }>();
    for (const m of messages) {
        const r = results.get(m.seq)!;
        let outcome: Record<string, unknown>;
        if (r.skipped) {
            summary.skipped[r.skipped] = (summary.skipped[r.skipped] ?? 0) + 1;
            outcome = { method: m.method ?? null, skipped: r.skipped };
        } else {
            summary.checked += 1;
            summary[r.valid ? 'valid' : 'invalid'] += 1;
            summary.advisories += r.advisories?.length ?? 0;
            outcome = { schema: r.schemaName ?? '?', valid: r.valid };
            if (!r.valid) {
                outcome.errors = r.errors.map((e) => `${e.path} ${e.keyword ?? ''}: ${e.message}`);
            }
            if (r.advisories?.length) outcome.advisories = r.advisories.map((a) => a.path);
        }
        const key = JSON.stringify(outcome);
        const group = groups.get(key) ?? { outcome, seqs: [] };
        group.seqs.push(m.seq);
        groups.set(key, group);
    }
    return {
        summary,
        outcomes: [...groups.values()]
            .sort((a, b) => a.seqs[0]! - b.seqs[0]!)
            .map(({ outcome, seqs }) => ({
                ...outcome,
                frames: seqs.length,
                firstSeqs: seqs.slice(0, 5),
            })),
    };
}

/**
 * What the detail panel shows for every field: in the spec or not, an
 * extension (`_meta`), its type, and whether a description exists. Array
 * indices are collapsed to `[]` and identical paths merged per message type.
 */
function specReport(messages: CapturedMessage[]) {
    const pairs = buildPairIndex(messages);
    const methodBySeq = new Map(messages.map((m) => [m.seq, m.method]));
    const out: Record<string, Record<string, Set<string>>> = {};
    for (const m of messages) {
        if (!m.payload) continue;
        const pair = pairs.get(m.seq);
        const pairedMethod = pair ? methodBySeq.get(pair.pairSeq) : undefined;
        const resolver = resolveSpecForMessage(m, pairedMethod ? { pairedMethod } : undefined);
        if (!resolver) continue;
        const envelope = m.kind === 'response' ? 'result' : m.kind === 'error' ? 'error' : 'params';
        const root = (m.payload as unknown as Record<string, unknown>)[envelope];
        const fields = (out[resolver.typeName] ??= {});
        walk(root, [envelope], (path) => {
            const info = resolver.resolve(path);
            const key = path.map((s) => (/^\d+$/.test(s) ? '[]' : s)).join('.');
            const desc = !info
                ? 'unresolved'
                : [
                      info.inSpec ? 'spec' : 'not-in-spec',
                      info.isExtension ? 'ext' : null,
                      info.type ?? null,
                      info.description ? 'desc' : null,
                      info.enumValues ? `enum(${info.enumValues.length})` : null,
                  ]
                      .filter(Boolean)
                      .join(' ');
            (fields[key] ??= new Set()).add(desc);
        });
    }
    return sortKeys(
        Object.fromEntries(
            Object.entries(out).map(([type, fields]) => [
                type,
                sortKeys(
                    Object.fromEntries(
                        Object.entries(fields).map(([k, v]) => [k, [...v].sort().join(' | ')]),
                    ),
                ),
            ]),
        ),
    );
}

function walk(value: unknown, path: string[], visit: (path: string[]) => void): void {
    visit(path);
    if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, [...path, String(i)], visit));
    } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, [...path, k], visit);
    }
}

function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

function report(messages: CapturedMessage[]) {
    const stats = buildPerMethodStats(messages);
    return {
        frames: messages.length,
        validation: validationReport(messages),
        metadata: extractSessionMetadata(messages),
        perMethod: stats.map(({ latencies: _latencies, ...rest }) => rest),
        insights: buildPerformanceInsights(messages, stats).map((i) => ({
            kind: i.kind,
            summary: i.summary,
            methods: i.methods,
        })),
        redactedFields: messages.reduce((n, m) => n + redactMessage(m).count, 0),
        previews: messages
            .slice(0, PREVIEW_FRAMES)
            .map((m) =>
                `${m.seq}${isUserPrompt(m) ? ' [prompt]' : ''} ${extractTextPreview(m) ?? ''}`.trimEnd(),
            ),
        spec: specReport(messages),
    };
}

describe('golden: analysis of every fixture session', () => {
    for (const fixture of loadFixtures()) {
        it(fixture.name, async () => {
            const golden = JSON.stringify(report(fixture.messages), null, 2) + '\n';
            await expect(golden).toMatchFileSnapshot(
                `./__golden__/${fixture.name.replace('/', '__')}.golden.json`,
            );
        });
    }
});
