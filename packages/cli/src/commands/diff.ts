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

            process.stdout.write(
                renderDiff(infoA, infoB, msgsA.length, msgsB.length, diff, meta, perf, Boolean(opts.full)),
            );
        });
}

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
): string {
    const lines: string[] = [];
    lines.push(`diff  #${infoA.id}  →  #${infoB.id}\n`);
    lines.push(`  A #${infoA.id}  ${shortLabel(infoA)}  (${countA} msg${countA === 1 ? '' : 's'})\n`);
    lines.push(`  B #${infoB.id}  ${shortLabel(infoB)}  (${countB} msg${countB === 1 ? '' : 's'})\n`);
    lines.push('\n');

    lines.push(renderInfoSection(meta));
    lines.push('\n');
    lines.push(renderPerfSection(perf));
    lines.push('\n');

    lines.push('FRAMES\n');
    const s = diff.summary;
    lines.push(
        `= ${s.equal} same   ≠ ${s.changed} differs   ◂ ${s.removed} only in A   ▸ ${s.added} only in B\n`,
    );
    lines.push('\n');

    if (s.changed === 0 && s.added === 0 && s.removed === 0 && !full) {
        lines.push('sessions are identical (no field-level differences)\n');
        return lines.join('');
    }

    let equalRun = 0;
    const flushEqualRun = () => {
        if (equalRun > 0) {
            lines.push(`   … ${equalRun} unchanged …\n`);
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
        const method = ref.method ?? (ref.parseError ? `! ${ref.parseError}` : '—');
        lines.push(
            `${OP_MARKER[row.op]} ${dirArrow(ref)} ${KIND_LABEL[ref.kind]} ${method}` +
                `   ${aSeq}  ${bSeq}\n`,
        );
        if (row.op === 'changed') {
            for (const c of row.changes) {
                lines.push(`      ${renderChange(c)}\n`);
            }
        }
    }
    flushEqualRun();

    return lines.join('');
}

export function renderChange(c: JsonChange): string {
    if (c.kind === 'add') return `+ ${c.path}: ${fmtValue(c.b)}`;
    if (c.kind === 'remove') return `- ${c.path}: ${fmtValue(c.a)}`;
    return `~ ${c.path}: ${fmtValue(c.a)} → ${fmtValue(c.b)}`;
}

export function renderInfoSection(meta: MetadataDiff): string {
    const lines = ['INFO\n'];
    if (meta.changes.length === 0) {
        lines.push('  metadata identical (client, agent, capabilities, protocol, runtime)\n');
    } else {
        for (const c of meta.changes) lines.push(`  ${renderChange(c)}\n`);
    }
    return lines.join('');
}

export function renderPerfSection(perf: MethodStatsDelta[]): string {
    if (perf.length === 0) return 'PERF\n  no methods\n';
    const cells = perf.map((d) => ({
        method: d.method,
        kind: d.kind === 'request' ? 'req' : 'ntf',
        ap99: d.a?.p99 != null ? formatLatency(d.a.p99) : '—',
        bp99: d.b?.p99 != null ? formatLatency(d.b.p99) : '—',
        dp99: d.p99Delta != null ? signedLatency(d.p99Delta) : '—',
        counts: `${d.a?.count ?? 0}→${d.b?.count ?? 0}`,
    }));
    const w = {
        method: Math.min(40, Math.max(6, ...cells.map((c) => c.method.length))),
        ap99: Math.max(5, ...cells.map((c) => c.ap99.length)),
        bp99: Math.max(5, ...cells.map((c) => c.bp99.length)),
        dp99: Math.max(6, ...cells.map((c) => c.dp99.length)),
        counts: Math.max(5, ...cells.map((c) => c.counts.length)),
    };
    const lines = ['PERF  (p99 latency, Δ = B − A, sorted by |Δ p99|)\n'];
    lines.push(
        'METHOD'.padEnd(w.method) +
            '  KIND  ' +
            'A p99'.padStart(w.ap99) +
            '  ' +
            'B p99'.padStart(w.bp99) +
            '  ' +
            'Δ p99'.padStart(w.dp99) +
            '  ' +
            'COUNT'.padStart(w.counts) +
            '\n',
    );
    for (const c of cells) {
        const method = c.method.length > w.method ? c.method.slice(0, w.method - 1) + '…' : c.method;
        lines.push(
            method.padEnd(w.method) +
                '  ' +
                c.kind.padEnd(4) +
                '  ' +
                c.ap99.padStart(w.ap99) +
                '  ' +
                c.bp99.padStart(w.bp99) +
                '  ' +
                c.dp99.padStart(w.dp99) +
                '  ' +
                c.counts.padStart(w.counts) +
                '\n',
        );
    }
    return lines.join('');
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
