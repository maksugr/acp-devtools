import type { Command } from 'commander';
import {
    defaultCapturesDbPath,
    listSessionsSummary,
    type SessionSummary,
} from '@acp-devtools/core';

interface ListCommandOptions {
    db: string;
    limit: string;
    imported?: boolean;
    saved?: boolean;
    json?: boolean;
}

export function registerListCommand(program: Command): void {
    program
        .command('list')
        .description(
            'List saved sessions in captures.db, newest first. Use `acp-devtools doctor` for live captures (those are not in the database).',
        )
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--limit <n>', 'maximum rows to show', '50')
        .option('--imported', 'only show imported sessions')
        .option('--saved', 'only show non-imported (live-captured) saved sessions')
        .option('--json', 'emit machine-readable JSON instead of a table')
        .action((opts: ListCommandOptions) => {
            const limit = Number(opts.limit);
            if (!Number.isInteger(limit) || limit < 1) {
                process.stderr.write(`acp-devtools: invalid --limit "${opts.limit}"\n`);
                process.exit(2);
            }
            let rows = listSessionsSummary(opts.db, limit);
            if (opts.imported) rows = rows.filter((r) => r.imported_at !== null);
            if (opts.saved) rows = rows.filter((r) => r.imported_at === null);

            if (opts.json) {
                process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
                return;
            }
            if (rows.length === 0) {
                process.stdout.write('no sessions\n');
                return;
            }
            process.stdout.write(formatTable(rows));
        });
}

interface Row {
    id: string;
    age: string;
    kind: string;
    msgs: string;
    label: string;
}

function rowFor(s: SessionSummary, now: number): Row {
    return {
        id: `#${s.id}`,
        age: formatAge(now - s.started_at),
        kind: s.imported_at !== null ? 'imported' : 'saved',
        msgs: `${s.message_count}msg`,
        label: labelOf(s),
    };
}

function labelOf(s: SessionSummary): string {
    if (s.name) return s.name;
    if (s.client_name && s.agent_command) return `${s.client_name} · ${s.agent_command}`;
    if (s.client_name) return s.client_name;
    return s.agent_command ?? '—';
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

function formatTable(rows: SessionSummary[]): string {
    const now = Date.now();
    const cells = rows.map((r) => rowFor(r, now));
    const widths = {
        id: Math.max(2, ...cells.map((c) => c.id.length)),
        age: Math.max(3, ...cells.map((c) => c.age.length)),
        kind: Math.max(4, ...cells.map((c) => c.kind.length)),
        msgs: Math.max(4, ...cells.map((c) => c.msgs.length)),
    };
    const lines: string[] = [];
    for (const c of cells) {
        lines.push(
            [
                c.id.padEnd(widths.id),
                c.age.padEnd(widths.age),
                c.kind.padEnd(widths.kind),
                c.msgs.padEnd(widths.msgs),
                c.label,
            ].join('  ') + '\n',
        );
    }
    return lines.join('');
}
