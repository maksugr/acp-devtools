import type { Command } from 'commander';
import {
    type CapturedMessage,
    type PairInfo,
    Session,
    buildPairIndex,
    defaultCapturesDbPath,
    extractTextPreview,
    openExistingDatabase,
    validateAcpMessage,
} from '@acp-devtools/core';
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';
import { colorDirection, colorKind, colorLatency } from '../lib/palette.js';
import { renderTable, type Column } from '../lib/table.js';

// Preserve the existing import path `./inspect.js` for downstream consumers
// (`stats.ts`, `inspect.test.ts`) — source of truth lives in core.
export { buildPairIndex, type PairInfo };

interface InspectCommandOptions {
    db: string;
    limit: string;
    fromSeq?: string;
    dir?: string;
    kind?: string;
    method?: string;
    grep?: string;
    paired?: boolean;
    preview: boolean;
    spec?: boolean;
    format: 'table' | 'jsonl' | 'raw';
}

const DIR_FROM_CODE: Record<string, CapturedMessage['direction']> = {
    out: 'editor-to-agent',
    in: 'agent-to-editor',
};
const KIND_FROM_CODE: Record<string, CapturedMessage['kind']> = {
    req: 'request',
    rsp: 'response',
    ntf: 'notification',
    err: 'error',
    unk: 'unknown',
};

export function registerInspectCommand(program: Command): void {
    program
        .command('inspect')
        .description(
            'Print messages of a saved session to stdout — the terminal equivalent of the inspector timeline. Combine with grep / jq for shell-side analysis.',
        )
        .argument('<id>', 'session id (see `acp-devtools list`)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--limit <n>', 'maximum messages to print', '500')
        .option('--from-seq <n>', 'start from this seq number (inclusive)')
        .option(
            '--dir <codes>',
            'direction filter; comma-separated subset of out,in (default: both)',
        )
        .option(
            '--kind <codes>',
            'kind filter; comma-separated subset of req,rsp,ntf,err,unk (default: all)',
        )
        .option('--method <pattern>', 'substring match on method name (case-insensitive)')
        .option('--grep <text>', 'substring match on the raw frame (case-insensitive)')
        .option('--paired', 'only show request/response/error frames — skip notifications')
        .option(
            '--no-preview',
            'omit the PREVIEW column (useful on narrow terminals or for grep-friendly output)',
        )
        .option(
            '--spec',
            'add a SPEC column showing schema-validation status (✓ / ⚠ N / blank for skipped frames)',
        )
        .option(
            '-f, --format <mode>',
            'output mode: table (human-readable, default), jsonl (one CapturedMessage per line), raw (just the JSON-RPC frames)',
            'table',
        )
        .action((rawId: string, opts: InspectCommandOptions) => {
            const id = Number(rawId);
            if (!Number.isInteger(id) || id <= 0) {
                process.stderr.write(`acp-devtools: invalid id "${rawId}"\n`);
                process.exit(2);
            }
            const limit = Number(opts.limit);
            if (!Number.isInteger(limit) || limit < 1) {
                process.stderr.write(`acp-devtools: invalid --limit "${opts.limit}"\n`);
                process.exit(2);
            }
            if (!['table', 'jsonl', 'raw'].includes(opts.format)) {
                process.stderr.write(`acp-devtools: invalid --format "${opts.format}"\n`);
                process.exit(2);
            }

            const filter = buildFilter(opts);

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

            let printed = 0;
            if (opts.format === 'jsonl' || opts.format === 'raw') {
                // Streaming modes: no pairing / latency computation, no buffering.
                // `jsonl` already carries full CapturedMessage data — pairing
                // can be done downstream with jq.
                for (const m of session.messages()) {
                    if (!passes(m, filter)) continue;
                    if (printed >= limit) break;
                    printed += 1;
                    process.stdout.write(
                        opts.format === 'jsonl' ? JSON.stringify(m) + '\n' : m.raw + '\n',
                    );
                }
            } else {
                // Table mode: buffer all messages so pair/latency columns can be
                // computed across the WHOLE session (otherwise --kind req would
                // hide the response and we couldn't show latency on the request).
                const all = [...session.messages()];
                const pairs = buildPairIndex(all);
                const seqToMethod = new Map<number, string>();
                for (const m of all) {
                    if (m.method) seqToMethod.set(m.seq, m.method);
                }
                const tableBuf: TableRow[] = [];
                for (const m of all) {
                    if (!passes(m, filter)) continue;
                    if (tableBuf.length >= limit) break;
                    let specCell = '';
                    if (opts.spec) {
                        const pair = pairs.get(m.seq);
                        const pairedMethod = pair ? seqToMethod.get(pair.pairSeq) : undefined;
                        const valOpts: Parameters<typeof validateAcpMessage>[1] = {};
                        if (pairedMethod !== undefined) valOpts.pairedMethod = pairedMethod;
                        const result = validateAcpMessage(m, valOpts);
                        if (result.skipped) specCell = '';
                        else if (result.valid) specCell = '✓';
                        else specCell = `⚠${result.errors.length}`;
                    }
                    tableBuf.push(toTableRow(m, pairs.get(m.seq), specCell));
                }
                printed = tableBuf.length;
                const s = createStyler(colorEnabled(process.stdout));
                process.stdout.write(
                    renderInspectTable(s, tableBuf, opts.preview !== false, Boolean(opts.spec)),
                );
            }

            db.close();
            if (printed === 0) {
                // grep-style: nothing matched → non-zero exit so shell
                // pipelines can branch on it (consistent with `search`).
                process.stderr.write('acp-devtools: no matching messages\n');
                process.exit(1);
            }
        });
}


interface InspectFilter {
    directions: Set<CapturedMessage['direction']> | null;
    kinds: Set<CapturedMessage['kind']> | null;
    methodPattern: string | null;
    grep: string | null;
    pairedOnly: boolean;
    fromSeq: number | null;
}

function buildFilter(opts: InspectCommandOptions): InspectFilter {
    const directions = parseDirections(opts.dir);
    const kinds = parseKinds(opts.kind);
    return {
        directions,
        kinds,
        methodPattern: opts.method ? opts.method.toLowerCase() : null,
        grep: opts.grep ? opts.grep.toLowerCase() : null,
        pairedOnly: Boolean(opts.paired),
        fromSeq: opts.fromSeq !== undefined ? Number(opts.fromSeq) : null,
    };
}

function parseDirections(raw: string | undefined): Set<CapturedMessage['direction']> | null {
    if (!raw) return null;
    const out = new Set<CapturedMessage['direction']>();
    for (const code of raw.split(',').map((c) => c.trim())) {
        const mapped = DIR_FROM_CODE[code];
        if (mapped) out.add(mapped);
    }
    return out.size > 0 ? out : null;
}

function parseKinds(raw: string | undefined): Set<CapturedMessage['kind']> | null {
    if (!raw) return null;
    const out = new Set<CapturedMessage['kind']>();
    for (const code of raw.split(',').map((c) => c.trim())) {
        const mapped = KIND_FROM_CODE[code];
        if (mapped) out.add(mapped);
    }
    return out.size > 0 ? out : null;
}

export function passes(m: CapturedMessage, f: InspectFilter): boolean {
    if (f.fromSeq !== null && m.seq < f.fromSeq) return false;
    if (f.directions && !f.directions.has(m.direction)) return false;
    if (f.kinds && !f.kinds.has(m.kind)) return false;
    if (f.pairedOnly && m.kind === 'notification') return false;
    if (f.methodPattern) {
        if (!m.method || !m.method.toLowerCase().includes(f.methodPattern)) return false;
    }
    if (f.grep && !m.raw.toLowerCase().includes(f.grep)) return false;
    return true;
}

interface TableRow {
    seq: string;
    time: string;
    dir: string;
    kind: string;
    method: string;
    rpcId: string;
    paired: string;
    latency: string;
    size: string;
    preview: string;
    spec: string;
    direction: CapturedMessage['direction'];
    kindEnum: CapturedMessage['kind'];
    latencyMs: number | null;
    isParseError: boolean;
}

const KIND_LABEL: Record<CapturedMessage['kind'], string> = {
    request: 'REQ',
    response: 'RSP',
    notification: 'NTF',
    error: 'ERR',
    unknown: 'UNK',
};

function toTableRow(m: CapturedMessage, pair: PairInfo | undefined, specCell: string = ''): TableRow {
    let paired = '—';
    let latency = '—';
    let latencyMs: number | null = null;
    if (pair !== undefined) {
        if (m.kind === 'request') paired = `→${pair.pairSeq}`;
        else if (m.kind === 'response' || m.kind === 'error') paired = `←${pair.pairSeq}`;
        latency = formatLatency(pair.latencyMs);
        latencyMs = pair.latencyMs;
    }
    // Parse failures surface in the METHOD column with a `!` prefix so they
    // stand out at a glance; the full error text is in jsonl/raw output.
    let method: string;
    let isParseError = false;
    if (m.method) {
        method = m.method;
    } else if (m.parseError) {
        method = `! ${m.parseError}`;
        isParseError = true;
    } else {
        method = '—';
    }
    const previewText = extractTextPreview(m);
    return {
        seq: String(m.seq),
        time: formatTime(m.timestamp),
        dir: m.direction === 'editor-to-agent' ? '→A' : 'A←',
        kind: KIND_LABEL[m.kind],
        method,
        rpcId: m.rpcId === undefined || m.rpcId === null ? '—' : String(m.rpcId),
        paired,
        latency,
        size: formatBytes(Buffer.byteLength(m.raw, 'utf8')),
        preview: previewText ? `"${collapseWhitespace(previewText)}"` : '',
        spec: specCell,
        direction: m.direction,
        kindEnum: m.kind,
        latencyMs,
        isParseError,
    };
}

function collapseWhitespace(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

export function formatLatency(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m${s}s`;
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toISOString().slice(11, 23); // HH:MM:SS.mmm in UTC
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const PREVIEW_MAX = 50;
const METHOD_MAX = 40; // a single weird method shouldn't blow the layout
const RPC_MAX = 10; // uuids in clientInfo._meta can be 36 chars long

function colorSpec(s: Styler, cell: string): string {
    if (cell === '✓') return s.green(cell);
    if (cell.startsWith('⚠')) return s.red(cell);
    return cell;
}

function renderInspectTable(
    s: Styler,
    rows: TableRow[],
    includePreview: boolean,
    includeSpec: boolean,
): string {
    if (rows.length === 0) return '';

    const columns: Column[] = [
        { title: 'SEQ', align: 'right' },
        { title: 'TIME', align: 'left' },
        { title: 'DIR', align: 'left' },
        { title: 'KIND', align: 'left' },
        { title: 'METHOD', align: 'left' },
        { title: 'RPC', align: 'right' },
        { title: 'PAIR', align: 'left' },
        { title: 'LATENCY', align: 'right' },
        { title: 'SIZE', align: 'right' },
    ];
    if (includeSpec) columns.push({ title: 'SPEC', align: 'left' });
    const showPreview = includePreview && rows.some((r) => r.preview);
    if (showPreview) columns.push({ title: 'PREVIEW', align: 'left' });

    const body = rows.map((r) => {
        const method = truncate(r.method, METHOD_MAX);
        const cells = [
            s.dim(r.seq),
            s.dim(r.time),
            colorDirection(s, r.direction, r.dir),
            colorKind(s, r.kindEnum, r.kind),
            r.isParseError ? s.red(method) : method,
            s.dim(truncate(r.rpcId, RPC_MAX)),
            s.dim(r.paired),
            r.latencyMs === null ? s.dim(r.latency) : colorLatency(s, r.latencyMs, r.latency),
            s.dim(r.size),
        ];
        if (includeSpec) cells.push(colorSpec(s, r.spec));
        if (showPreview) cells.push(s.dim(truncate(r.preview, PREVIEW_MAX + 2)));
        return cells;
    });

    return renderTable(s, columns, body);
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)) + '…';
}
