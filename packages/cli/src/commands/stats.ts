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
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';
import { colorKind, colorLatency } from '../lib/palette.js';
import { renderTable, type Column } from '../lib/table.js';

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
            const s = createStyler(colorEnabled(process.stdout));
            process.stdout.write(renderStats(s, stats, Boolean(opts.byMethod)));
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

function heading(s: Styler, label: string): string {
    return s.bold(s.yellow(label));
}

function renderStats(s: Styler, stats: SessionStats, byMethod: boolean): string {
    const lines: string[] = [];
    const headerBits = [
        s.bold(s.cyan(`session #${stats.sessionId}`)),
        s.dim(`${formatAge(Date.now() - stats.startedAt)} ago`),
        s.dim(
            stats.endedAt !== null
                ? `lasted ${formatAge(stats.endedAt - stats.startedAt)}`
                : 'still open',
        ),
        shortLabel(stats),
    ];
    lines.push(headerBits.join(s.dim('  ·  ')) + '\n');
    lines.push('\n');

    lines.push(heading(s, 'DIRECTION') + '\n');
    lines.push(`${s.green('→ editor → agent')}   ${stats.direction.editorToAgent}\n`);
    lines.push(`${s.cyan('← agent → editor')}   ${stats.direction.agentToEditor}\n`);
    lines.push('\n');

    lines.push(heading(s, 'KIND') + '\n');
    lines.push(`${colorKind(s, 'request', 'REQ')}    ${stats.kind.request}\n`);
    lines.push(`${colorKind(s, 'response', 'RSP')}    ${stats.kind.response}\n`);
    lines.push(`${colorKind(s, 'notification', 'NTF')}    ${stats.kind.notification}\n`);
    lines.push(`${colorKind(s, 'error', 'ERR')}    ${stats.kind.error}\n`);
    if (stats.kind.unknown > 0) lines.push(`${colorKind(s, 'unknown', 'UNK')}    ${stats.kind.unknown}\n`);
    if (stats.parseErrors > 0) lines.push(`${s.red('PARSE')}  ${stats.parseErrors}\n`);
    lines.push('\n');

    if (stats.spec.checked > 0) {
        lines.push(heading(s, 'SPEC') + '\n');
        if (stats.spec.violations === 0) {
            lines.push(`${stats.spec.checked} frames checked · ${s.green('all conform')}\n`);
        } else {
            const plural = stats.spec.violations === 1 ? '' : 's';
            const mPlural = stats.spec.affectedMethods.length === 1 ? '' : 's';
            lines.push(
                `${stats.spec.checked} checked · ${s.red(`${stats.spec.violations} violation${plural}`)} in ${stats.spec.affectedMethods.length} method${mPlural} (${stats.spec.affectedMethods.join(', ')})\n`,
            );
            lines.push(s.dim(`run \`acp-devtools validate ${stats.sessionId}\` for details`) + '\n');
        }
        lines.push('\n');
    }

    const l = stats.latency;
    if (l.sampleSize === 0) {
        lines.push(heading(s, 'LATENCY') + s.dim(' — no paired req/rsp samples') + '\n');
    } else {
        lines.push(
            heading(s, 'LATENCY') +
                s.dim(` (response pairs · ${l.sampleSize} sample${l.sampleSize === 1 ? '' : 's'})`) +
                '\n',
        );
        lines.push(`p50    ${colorLatency(s, l.p50!, formatLatency(l.p50!))}\n`);
        lines.push(`p90    ${colorLatency(s, l.p90!, formatLatency(l.p90!))}\n`);
        lines.push(`p99    ${colorLatency(s, l.p99!, formatLatency(l.p99!))}\n`);
        lines.push(`max    ${colorLatency(s, l.max!, formatLatency(l.max!))}\n`);
        lines.push(`mean   ${colorLatency(s, l.mean!, formatLatency(l.mean!))}\n`);
    }

    if (stats.insights.length > 0) {
        lines.push('\n');
        lines.push(renderInsights(s, stats.insights));
    }

    if (byMethod && stats.perMethod.length > 0) {
        lines.push('\n');
        lines.push(renderPerMethod(s, stats.perMethod));
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

const INSIGHT_COLOR: Record<PerformanceInsight['kind'], keyof Pick<Styler, 'red' | 'yellow' | 'magenta' | 'cyan'>> = {
    hotspot: 'red',
    'long-tail': 'yellow',
    outlier: 'magenta',
    busiest: 'cyan',
    errors: 'red',
};

function renderInsights(s: Styler, insights: PerformanceInsight[]): string {
    const lines: string[] = [heading(s, 'INSIGHTS') + '\n'];
    for (const i of insights) {
        const tint = s[INSIGHT_COLOR[i.kind]].bind(s);
        const glyph = tint(INSIGHT_GLYPH[i.kind]);
        const label = tint(INSIGHT_LABEL[i.kind]);
        lines.push(`  ${glyph}  ${label}  ${i.summary}\n`);
        if (i.detail) lines.push(s.dim(`                    ${i.detail}`) + '\n');
    }
    return lines.join('');
}

const METHOD_MAX = 40;

function renderPerMethod(s: Styler, rows: MethodStats[]): string {
    const columns: Column[] = [
        { title: 'METHOD', align: 'left' },
        { title: 'KIND', align: 'left' },
        { title: 'COUNT', align: 'right' },
        { title: 'P50', align: 'right' },
        { title: 'P99', align: 'right' },
        { title: 'TOTAL', align: 'right' },
        { title: 'DIST', align: 'left' },
    ];
    const body = rows.map((r) => {
        const method =
            r.method.length > METHOD_MAX ? r.method.slice(0, METHOD_MAX - 1) + '…' : r.method;
        return [
            method,
            colorKind(s, r.kind, r.kind === 'request' ? 'req' : 'ntf'),
            s.dim(String(r.count)),
            r.p50 !== null ? colorLatency(s, r.p50, formatLatency(r.p50)) : s.dim('—'),
            r.p99 !== null ? colorLatency(s, r.p99, formatLatency(r.p99)) : s.dim('—'),
            r.totalLatencyMs !== null ? formatLatency(r.totalLatencyMs) : s.dim('—'),
            r.latencies.length > 0 ? s.dim(asciiSparkline(r.latencies, 8)) : '',
        ];
    });
    return renderTable(s, columns, body);
}
