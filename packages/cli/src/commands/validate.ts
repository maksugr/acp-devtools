import type { Command } from 'commander';
import {
    type CapturedMessage,
    Session,
    defaultCapturesDbPath,
    openDatabase,
    validateAcpMessage,
} from '@acp-devtools/core';
import { buildPairIndex } from './inspect.js';

interface ValidateCommandOptions {
    db: string;
    limit: string;
    method?: string;
    json?: boolean;
}

interface Violation {
    seq: number;
    method: string | null;
    direction: CapturedMessage['direction'];
    schemaName: string;
    path: string;
    message: string;
    keyword?: string;
}

export function registerValidateCommand(program: Command): void {
    program
        .command('validate')
        .description(
            'Check every frame in a session against the official ACP JSON schema (`@agentclientprotocol/sdk`). Use to confirm that an editor or agent you do not control speaks the protocol correctly — same data the inspector\'s ⚠ SPEC badges surface.',
        )
        .argument('<id>', 'session id (see `acp-devtools list`)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--limit <n>', 'maximum violations to print', '200')
        .option('--method <pattern>', 'only check messages whose method contains this substring')
        .option('--json', 'machine-readable JSON')
        .action((rawId: string, opts: ValidateCommandOptions) => {
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
            let db;
            try {
                db = openDatabase(opts.db);
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
            db.close();

            const pairs = buildPairIndex(messages);
            const seqToMethod = new Map<number, string>();
            for (const m of messages) {
                if (m.method) seqToMethod.set(m.seq, m.method);
            }

            const methodNeedle = opts.method ? opts.method.toLowerCase() : null;
            const violations: Violation[] = [];
            let checked = 0;
            let skipped = 0;
            for (const m of messages) {
                const pair = pairs.get(m.seq);
                const pairedMethod = pair ? seqToMethod.get(pair.pairSeq) : undefined;
                const opts2: Parameters<typeof validateAcpMessage>[1] = {};
                if (pairedMethod !== undefined) opts2.pairedMethod = pairedMethod;
                const result = validateAcpMessage(m, opts2);
                if (result.skipped) {
                    skipped += 1;
                    continue;
                }
                checked += 1;
                if (result.valid) continue;
                const method = m.method ?? pairedMethod ?? null;
                if (methodNeedle && (!method || !method.toLowerCase().includes(methodNeedle))) {
                    continue;
                }
                for (const e of result.errors) {
                    if (violations.length >= limit) break;
                    const v: Violation = {
                        seq: m.seq,
                        method,
                        direction: m.direction,
                        schemaName: result.schemaName ?? '?',
                        path: e.path,
                        message: e.message,
                    };
                    if (e.keyword !== undefined) v.keyword = e.keyword;
                    violations.push(v);
                }
                if (violations.length >= limit) break;
            }

            if (opts.json) {
                process.stdout.write(
                    JSON.stringify(
                        { sessionId: id, checked, skipped, violations },
                        null,
                        2,
                    ) + '\n',
                );
                if (violations.length > 0) process.exit(1);
                return;
            }

            const affected = new Set(violations.map((v) => v.method ?? '?'));
            process.stderr.write(
                `session #${id} · ${checked} checked · ${skipped} skipped (no schema) · ${violations.length} violations in ${affected.size} method${affected.size === 1 ? '' : 's'}\n\n`,
            );
            if (violations.length === 0) {
                process.stdout.write('no violations\n');
                return;
            }
            process.stdout.write(renderTable(violations));
            // Non-zero exit so CI scripts can fail on first violation.
            process.exit(1);
        });
}

interface Cell {
    seq: string;
    method: string;
    schema: string;
    path: string;
    error: string;
}

function renderTable(violations: Violation[]): string {
    const rows: Cell[] = violations.map((v) => ({
        seq: `#${v.seq}`,
        method: v.method ?? '—',
        schema: v.schemaName,
        path: v.path,
        error: v.message,
    }));
    const widths = {
        seq: Math.max(3, ...rows.map((r) => r.seq.length)),
        method: Math.max(6, ...rows.map((r) => r.method.length)),
        schema: Math.max(6, ...rows.map((r) => r.schema.length)),
        path: Math.max(4, ...rows.map((r) => r.path.length)),
    };
    widths.method = Math.min(28, widths.method);
    widths.schema = Math.min(28, widths.schema);
    widths.path = Math.min(38, widths.path);
    return (
        rows
            .map((r) => {
                return (
                    [
                        r.seq.padStart(widths.seq),
                        truncate(r.method, widths.method).padEnd(widths.method),
                        truncate(r.schema, widths.schema).padEnd(widths.schema),
                        truncate(r.path, widths.path).padEnd(widths.path),
                        r.error,
                    ].join('  ') + '\n'
                );
            })
            .join('')
    );
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)) + '…';
}
