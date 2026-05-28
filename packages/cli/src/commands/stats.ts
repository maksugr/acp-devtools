import type { Command } from 'commander';
import {
    asciiSparkline,
    buildPairIndex,
    buildPerformanceInsights,
    buildPerMethodStats,
    type CapturedMessage,
    defaultCapturesDbPath,
    type MethodStats,
    openExistingDatabase,
    percentile as corePercentile,
    type PerformanceInsight,
    Session,
    type SessionRecord,
    validateAcpMessage,
} from '@acp-devtools/core';

interface StatsCommandOptions {
    db: string;
    json?: boolean;
    byMethod?: boolean;
}

export interface SessionStats {
    sessionId: number;
    sessionName: string | null;
    clientName: string | null;
    agentCommand: string | null;
    startedAt: number;
    endedAt: number | null;
    importedAt: number | null;
    total: number;
    direction: { editorToAgent: number; agentToEditor: number };
    kind: { request: number; response: number; notification: number; error: number; unknown: number };
    parseErrors: number;
    spec: { checked: number; valid: number; violations: number; affectedMethods: string[] };
    latency: {
        sampleSize: number;
        p50: number | null;
        p90: number | null;
        p99: number | null;
        max: number | null;
        mean: number | null;
    };
    perMethod: MethodStats[];
    insights: PerformanceInsight[];
}

export { type MethodStats };

// Re-export so existing `import { percentile } from './stats.js'` still works.
export const percentile = corePercentile;

export function registerStatsCommand(program: Command): void {
    program
        .command('stats')
        .description(
            'Aggregate counts and latency percentiles for one saved session — the equivalent of the inspector\'s footer StatsBar.',
        )
        .argument('<id>', 'session id (see `acp-devtools list`)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--by-method', 'add a per-method breakdown table (method · count · p50 · p99)')
        .option('--json', 'machine-readable JSON instead of human-readable text')
        .action((rawId: string, opts: StatsCommandOptions) => {
            const id = Number(rawId);
            if (!Number.isInteger(id) || id <= 0) {
                process.stderr.write(`acp-devtools: invalid id "${rawId}"\n`);
                process.exit(2);
            }
            let db;
            try {
                db = openExistingDatabase(opts.db);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot open ${opts.db}: ${msg}\n`);
                process.exit(1);
            }
            let session: Session;
            try {
                session = Session.load(db, id);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: ${msg}\n`);
                db.close();
                process.exit(1);
            }
            const messages = [...session.messages()];
            const stats = computeStats(session.info, messages);
            db.close();

            if (opts.json) {
                const out = opts.byMethod ? stats : { ...stats, perMethod: undefined };
                process.stdout.write(JSON.stringify(out, null, 2) + '\n');
                return;
            }
            process.stdout.write(renderStats(stats, Boolean(opts.byMethod)));
        });
}

export function computeStats(info: SessionRecord, messages: CapturedMessage[]): SessionStats {
    const direction = { editorToAgent: 0, agentToEditor: 0 };
    const kind = { request: 0, response: 0, notification: 0, error: 0, unknown: 0 };
    let parseErrors = 0;
    for (const m of messages) {
        if (m.direction === 'editor-to-agent') direction.editorToAgent += 1;
        else direction.agentToEditor += 1;
        kind[m.kind] += 1;
        if (m.parseError) parseErrors += 1;
    }

    const pairs = buildPairIndex(messages);
    const latencies: number[] = [];
    // Latency samples come from REQUESTS (one per request) so we don't
    // double-count the same pair via its response.
    for (const m of messages) {
        if (m.kind !== 'request') continue;
        const pair = pairs.get(m.seq);
        if (pair) latencies.push(pair.latencyMs);
    }
    latencies.sort((a, b) => a - b);

    // Schema validation rollup. Counts checked frames (skipped ones don't
    // count toward valid OR violations), violation count, and the unique set
    // of methods that produced at least one violation.
    const seqToMethod = new Map<number, string>();
    for (const m of messages) {
        if (m.method) seqToMethod.set(m.seq, m.method);
    }
    let specChecked = 0;
    let specValid = 0;
    let specViolations = 0;
    const affectedMethods = new Set<string>();
    for (const m of messages) {
        const pair = pairs.get(m.seq);
        const pairedMethod = pair ? seqToMethod.get(pair.pairSeq) : undefined;
        const opts: Parameters<typeof validateAcpMessage>[1] = {};
        if (pairedMethod !== undefined) opts.pairedMethod = pairedMethod;
        const result = validateAcpMessage(m, opts);
        if (result.skipped) continue;
        specChecked += 1;
        if (result.valid) {
            specValid += 1;
        } else {
            specViolations += result.errors.length;
            const method = m.method ?? pairedMethod;
            if (method) affectedMethods.add(method);
        }
    }

    const perMethod = buildPerMethodStats(messages);
    const insights = buildPerformanceInsights(messages, perMethod);

    return {
        sessionId: info.id,
        sessionName: info.name,
        clientName: info.clientName,
        agentCommand: info.agentCommand,
        startedAt: info.startedAt,
        endedAt: info.endedAt,
        importedAt: info.importedAt,
        total: messages.length,
        direction,
        kind,
        parseErrors,
        spec: {
            checked: specChecked,
            valid: specValid,
            violations: specViolations,
            affectedMethods: [...affectedMethods].sort(),
        },
        latency: {
            sampleSize: latencies.length,
            p50: latencies.length ? percentile(latencies, 50) : null,
            p90: latencies.length ? percentile(latencies, 90) : null,
            p99: latencies.length ? percentile(latencies, 99) : null,
            max: latencies.length ? latencies[latencies.length - 1]! : null,
            mean: latencies.length ? Math.round(mean(latencies)) : null,
        },
        perMethod,
        insights,
    };
}

function mean(xs: number[]): number {
    return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}

export function formatLatency(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m${s}s`;
}

function formatAge(deltaMs: number): string {
    const s = Math.max(0, Math.round(deltaMs / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h${m % 60 > 0 ? `${m % 60}m` : ''}`;
    return `${Math.floor(h / 24)}d`;
}

function shortLabel(s: SessionStats): string {
    const bits: string[] = [];
    if (s.clientName) bits.push(s.clientName);
    if (s.agentCommand) bits.push(s.agentCommand);
    return bits.join(' · ') || (s.sessionName ?? '—');
}

function renderStats(s: SessionStats, byMethod: boolean): string {
    const lines: string[] = [];
    const headerBits = [
        `session #${s.sessionId}`,
        `${formatAge(Date.now() - s.startedAt)} ago`,
        s.endedAt !== null
            ? `lasted ${formatAge(s.endedAt - s.startedAt)}`
            : 'still open',
        shortLabel(s),
    ];
    lines.push(headerBits.join('  ·  ') + '\n');

    lines.push('DIRECTION          COUNT\n');
    lines.push(`→ editor → agent   ${s.direction.editorToAgent}\n`);
    lines.push(`← agent → editor   ${s.direction.agentToEditor}\n`);
    lines.push('\n');

    lines.push('KIND   COUNT\n');
    lines.push(`REQ    ${s.kind.request}\n`);
    lines.push(`RSP    ${s.kind.response}\n`);
    lines.push(`NTF    ${s.kind.notification}\n`);
    lines.push(`ERR    ${s.kind.error}\n`);
    if (s.kind.unknown > 0) lines.push(`UNK    ${s.kind.unknown}\n`);
    if (s.parseErrors > 0) lines.push(`PARSE  ${s.parseErrors}\n`);
    lines.push('\n');

    if (s.spec.checked > 0) {
        if (s.spec.violations === 0) {
            lines.push(`SPEC   ${s.spec.checked} frames checked · all conform\n`);
        } else {
            lines.push(
                `SPEC   ${s.spec.checked} checked · ${s.spec.violations} violation${s.spec.violations === 1 ? '' : 's'} in ${s.spec.affectedMethods.length} method${s.spec.affectedMethods.length === 1 ? '' : 's'} (${s.spec.affectedMethods.join(', ')})\n`,
            );
            lines.push(`       run \`acp-devtools validate ${s.sessionId}\` for details\n`);
        }
        lines.push('\n');
    }

    const l = s.latency;
    if (l.sampleSize === 0) {
        lines.push('LATENCY — no paired req/rsp samples\n');
    } else {
        lines.push(`LATENCY (response pairs · ${l.sampleSize} sample${l.sampleSize === 1 ? '' : 's'})\n`);
        lines.push(`p50    ${formatLatency(l.p50!)}\n`);
        lines.push(`p90    ${formatLatency(l.p90!)}\n`);
        lines.push(`p99    ${formatLatency(l.p99!)}\n`);
        lines.push(`max    ${formatLatency(l.max!)}\n`);
        lines.push(`mean   ${formatLatency(l.mean!)}\n`);
    }

    if (s.insights.length > 0) {
        lines.push('\n');
        lines.push(renderInsights(s.insights));
    }

    if (byMethod && s.perMethod.length > 0) {
        lines.push('\n');
        lines.push(renderPerMethod(s.perMethod));
    }

    return lines.join('');
}

const INSIGHT_GLYPH: Record<PerformanceInsight['kind'], string> = {
    hotspot: '!',
    'long-tail': '~',
    outlier: '*',
    busiest: '#',
    errors: 'x',
};

const INSIGHT_LABEL: Record<PerformanceInsight['kind'], string> = {
    hotspot: 'HOTSPOT  ',
    'long-tail': 'LONG TAIL',
    outlier: 'OUTLIER  ',
    busiest: 'BUSIEST  ',
    errors: 'ERRORS   ',
};

function renderInsights(insights: PerformanceInsight[]): string {
    const lines: string[] = ['INSIGHTS\n'];
    for (const i of insights) {
        lines.push(`  ${INSIGHT_GLYPH[i.kind]}  ${INSIGHT_LABEL[i.kind]}  ${i.summary}\n`);
        if (i.detail) lines.push(`                    ${i.detail}\n`);
    }
    return lines.join('');
}

function renderPerMethod(rows: MethodStats[]): string {
    type Cell = {
        method: string;
        kind: string;
        count: string;
        p50: string;
        p99: string;
        total: string;
        dist: string;
    };
    const cells: Cell[] = rows.map((r) => ({
        method: r.method,
        kind: r.kind === 'request' ? 'req' : 'ntf',
        count: String(r.count),
        p50: r.p50 !== null ? formatLatency(r.p50) : '—',
        p99: r.p99 !== null ? formatLatency(r.p99) : '—',
        total: r.totalLatencyMs !== null ? formatLatency(r.totalLatencyMs) : '—',
        dist: r.latencies.length > 0 ? asciiSparkline(r.latencies, 8) : '',
    }));
    const widths = {
        method: Math.max(6, ...cells.map((c) => c.method.length)),
        kind: 4,
        count: Math.max(5, ...cells.map((c) => c.count.length)),
        p50: Math.max(5, ...cells.map((c) => c.p50.length)),
        p99: Math.max(5, ...cells.map((c) => c.p99.length)),
        total: Math.max(5, ...cells.map((c) => c.total.length)),
        dist: 8,
    };
    widths.method = Math.min(40, widths.method);

    const header =
        'METHOD'.padEnd(widths.method) +
        '  ' +
        'KIND'.padEnd(widths.kind) +
        '  ' +
        'COUNT'.padStart(widths.count) +
        '  ' +
        'P50'.padStart(widths.p50) +
        '  ' +
        'P99'.padStart(widths.p99) +
        '  ' +
        'TOTAL'.padStart(widths.total) +
        '  ' +
        'DIST'.padEnd(widths.dist) +
        '\n';

    const lines = [header];
    for (const c of cells) {
        const method = c.method.length > widths.method ? c.method.slice(0, widths.method - 1) + '…' : c.method;
        lines.push(
            method.padEnd(widths.method) +
                '  ' +
                c.kind.padEnd(widths.kind) +
                '  ' +
                c.count.padStart(widths.count) +
                '  ' +
                c.p50.padStart(widths.p50) +
                '  ' +
                c.p99.padStart(widths.p99) +
                '  ' +
                c.total.padStart(widths.total) +
                '  ' +
                c.dist.padEnd(widths.dist) +
                '\n',
        );
    }
    return lines.join('');
}
