import type { Command } from 'commander';
import {
    buildMetadataDiff,
    buildMethodStatsDiff,
    buildSessionDiff,
    type CapturedMessage,
    type DiffRow,
    defaultCapturesDbPath,
    type JsonChange,
    type MetadataDiff,
    type MethodStatsDelta,
    openExistingDatabase,
    Session,
    type SessionDiff,
    type SessionRecord,
} from '@acp-devtools/core';
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';
import { colorDirection, colorKind } from '../lib/palette.js';
import { renderTable, type Column } from '../lib/table.js';

interface DiffCommandOptions {
    db: string;
    json?: boolean;
    full?: boolean;
}

export function registerDiffCommand(program: Command): void {
    program
        .command('diff')
        .description(
            'Align two saved sessions and show what changed between them — added / removed frames and field-level payload differences. Useful for "worked yesterday, broke today" and A/B comparisons of two agents on the same prompt.',
        )
        .argument('<a>', 'baseline session id (left side)')
        .argument('<b>', 'new session id (right side)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--full', 'print unchanged frames too (default collapses equal runs)')
        .option('--json', 'machine-readable JSON instead of human-readable text')
        .action((rawA: string, rawB: string, opts: DiffCommandOptions) => {
            const idA = parseId(rawA);
            const idB = parseId(rawB);

            let db;
            try {
                db = openExistingDatabase(opts.db);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot open ${opts.db}: ${msg}\n`);
                process.exit(1);
            }

            let infoA: SessionRecord;
            let infoB: SessionRecord;
            let msgsA: CapturedMessage[];
            let msgsB: CapturedMessage[];
            try {
                const a = Session.load(db, idA);
                const b = Session.load(db, idB);
                infoA = a.info;
                infoB = b.info;
                msgsA = [...a.messages()];
                msgsB = [...b.messages()];
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: ${msg}\n`);
                db.close();
                process.exit(1);
            }
            db.close();

            const diff = buildSessionDiff(msgsA, msgsB);
            const meta = buildMetadataDiff(msgsA, msgsB);
            const perf = buildMethodStatsDiff(msgsA, msgsB);

            if (opts.json) {
                process.stdout.write(
                    JSON.stringify(
                        {
                            a: headerJson(infoA, msgsA.length),
                            b: headerJson(infoB, msgsB.length),
                            summary: diff.summary,
                            metadata: meta.changes,
                            perf,
                            rows: diff.rows,
                        },
                        null,
                        2,
                    ) + '\n',
                );
                return;
            }

            const st = createStyler(colorEnabled(process.stdout));
            process.stdout.write(
                renderDiff(infoA, infoB, msgsA.length, msgsB.length, diff, meta, perf, Boolean(opts.full), st),
            );
        });
}

const defaultStyler = (): Styler => createStyler(colorEnabled(process.stdout));

function heading(st: Styler, label: string): string {
    return st.bold(st.yellow(label));
}

const OP_COLOR: Record<DiffRow['op'], (st: Styler, t: string) => string> = {
    equal: (st, t) => st.dim(t),
    changed: (st, t) => st.yellow(t),
    added: (st, t) => st.green(t),
    removed: (st, t) => st.red(t),
};

function parseId(raw: string): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        process.stderr.write(`acp-devtools: invalid id "${raw}"\n`);
        process.exit(2);
    }
    return id;
}

export function headerJson(info: SessionRecord, messageCount: number) {
    return {
        id: info.id,
        label: shortLabel(info),
        messageCount,
    };
}

function shortLabel(info: SessionRecord): string {
    const bits: string[] = [];
    if (info.clientName) bits.push(info.clientName);
    if (info.agentCommand) bits.push(info.agentCommand);
    if (bits.length === 0 && info.name) bits.push(info.name);
    return bits.join(' · ') || '—';
}

const KIND_LABEL: Record<CapturedMessage['kind'], string> = {
    request: 'REQ',
    response: 'RSP',
    notification: 'NTF',
    error: 'ERR',
    unknown: 'UNK',
};

// Set-membership framing (two independent sessions): same / differs /
// only-in-A / only-in-B. Arrow points at the side holding the frame. The
// machine `DiffOp` values (equal/changed/added/removed) are unchanged — this
// is presentation only.
const OP_MARKER: Record<DiffRow['op'], string> = {
    equal: '=',
    changed: '≠',
    added: '▸',
    removed: '◂',
};

function dirArrow(m: CapturedMessage): string {
    return m.direction === 'editor-to-agent' ? '→A' : 'A←';
}

export function renderDiff(
    infoA: SessionRecord,
    infoB: SessionRecord,
    countA: number,
    countB: number,
    diff: SessionDiff,
    meta: MetadataDiff,
    perf: MethodStatsDelta[],
    full: boolean,
    st: Styler = defaultStyler(),
): string {
    const lines: string[] = [];
    lines.push(`${st.bold('diff')}  ${st.cyan(`#${infoA.id}`)}  ${st.dim('→')}  ${st.cyan(`#${infoB.id}`)}\n`);
    lines.push(`  ${st.cyan(`A #${infoA.id}`)}  ${shortLabel(infoA)}  ${st.dim(`(${countA} msg${countA === 1 ? '' : 's'})`)}\n`);
    lines.push(`  ${st.cyan(`B #${infoB.id}`)}  ${shortLabel(infoB)}  ${st.dim(`(${countB} msg${countB === 1 ? '' : 's'})`)}\n`);
    lines.push('\n');

    lines.push(renderInfoSection(meta, st));
    lines.push('\n');
    lines.push(renderPerfSection(perf, st));
    lines.push('\n');

    lines.push(heading(st, 'FRAMES') + '\n');
    const sum = diff.summary;
    lines.push(
        `${st.dim('=')} ${sum.equal} same   ${st.yellow('≠')} ${sum.changed} differs   ${st.red('◂')} ${sum.removed} only in A   ${st.green('▸')} ${sum.added} only in B\n`,
    );
    lines.push('\n');

    if (sum.changed === 0 && sum.added === 0 && sum.removed === 0 && !full) {
        lines.push(st.green('sessions are identical') + st.dim(' (no field-level differences)') + '\n');
        return lines.join('');
    }

    let equalRun = 0;
    const flushEqualRun = () => {
        if (equalRun > 0) {
            lines.push(st.dim(`   … ${equalRun} unchanged …`) + '\n');
            equalRun = 0;
        }
    };

    for (const row of diff.rows) {
        if (row.op === 'equal' && !full) {
            equalRun += 1;
            continue;
        }
        flushEqualRun();
        const ref = row.a ?? row.b!;
        const aSeq = row.a ? `a#${row.a.seq}` : 'a#—';
        const bSeq = row.b ? `b#${row.b.seq}` : 'b#—';
        const rawMethod = ref.method ?? (ref.parseError ? `! ${ref.parseError}` : '—');
        const method = ref.parseError ? st.red(rawMethod) : rawMethod;
        lines.push(
            `${OP_COLOR[row.op](st, OP_MARKER[row.op])} ${colorDirection(st, ref.direction, dirArrow(ref))} ${colorKind(st, ref.kind, KIND_LABEL[ref.kind])} ${method}` +
                `   ${st.dim(aSeq)}  ${st.dim(bSeq)}\n`,
        );
        if (row.op === 'changed') {
            for (const c of row.changes) {
                lines.push(`      ${renderChange(c, st)}\n`);
            }
        }
    }
    flushEqualRun();

    return lines.join('');
}

export function renderChange(c: JsonChange, st: Styler = defaultStyler()): string {
    if (c.kind === 'add') return `${st.green('+')} ${c.path}: ${st.dim(fmtValue(c.b))}`;
    if (c.kind === 'remove') return `${st.red('-')} ${c.path}: ${st.dim(fmtValue(c.a))}`;
    return `${st.yellow('~')} ${c.path}: ${st.dim(fmtValue(c.a))} ${st.dim('→')} ${st.dim(fmtValue(c.b))}`;
}

export function renderInfoSection(meta: MetadataDiff, st: Styler = defaultStyler()): string {
    const lines = [heading(st, 'INFO') + '\n'];
    if (meta.changes.length === 0) {
        lines.push(
            st.dim('  metadata identical (client, agent, capabilities, protocol, runtime)') + '\n',
        );
    } else {
        for (const c of meta.changes) lines.push(`  ${renderChange(c, st)}\n`);
    }
    return lines.join('');
}

const PERF_METHOD_MAX = 40;

function colorDelta(st: Styler, ms: number | null | undefined): string {
    if (ms == null) return st.dim('—');
    const text = signedLatency(ms);
    if (ms > 0) return st.red(text);
    if (ms < 0) return st.green(text);
    return st.dim(text);
}

export function renderPerfSection(perf: MethodStatsDelta[], st: Styler = defaultStyler()): string {
    if (perf.length === 0) return heading(st, 'PERF') + '\n' + st.dim('  no methods') + '\n';
    const columns: Column[] = [
        { title: 'METHOD', align: 'left' },
        { title: 'KIND', align: 'left' },
        { title: 'A p99', align: 'right' },
        { title: 'B p99', align: 'right' },
        { title: 'Δ p99', align: 'right' },
        { title: 'COUNT', align: 'right' },
    ];
    const body = perf.map((d) => {
        const method =
            d.method.length > PERF_METHOD_MAX ? d.method.slice(0, PERF_METHOD_MAX - 1) + '…' : d.method;
        return [
            method,
            colorKind(st, d.kind, d.kind === 'request' ? 'req' : 'ntf'),
            d.a?.p99 != null ? formatLatency(d.a.p99) : st.dim('—'),
            d.b?.p99 != null ? formatLatency(d.b.p99) : st.dim('—'),
            colorDelta(st, d.p99Delta),
            st.dim(`${d.a?.count ?? 0}→${d.b?.count ?? 0}`),
        ];
    });
    return (
        heading(st, 'PERF') +
        st.dim('  (p99 latency, Δ = B − A, sorted by |Δ p99|)') +
        '\n' +
        renderTable(st, columns, body)
    );
}

function formatLatency(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m${s}s`;
}

function signedLatency(ms: number): string {
    if (ms === 0) return '0';
    const sign = ms > 0 ? '+' : '−';
    return sign + formatLatency(Math.abs(ms));
}

const VALUE_MAX = 60;

function fmtValue(v: unknown): string {
    let s: string;
    try {
        s = JSON.stringify(v);
    } catch {
        s = String(v);
    }
    if (s === undefined) s = 'undefined';
    s = s.replace(/\s+/g, ' ');
    if (s.length > VALUE_MAX) s = s.slice(0, VALUE_MAX - 1) + '…';
    return s;
}
