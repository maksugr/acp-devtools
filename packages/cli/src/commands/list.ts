import type { Command } from 'commander';
import {
    defaultCapturesDbPath,
    listSessionsSummary,
    type SessionFilters,
    type SessionSummary,
} from '@acp-devtools/core';
import { colorEnabled, createStyler } from '../lib/style.js';
import { colorSessionKind } from '../lib/palette.js';
import { renderTable, type Column } from '../lib/table.js';

interface ListCommandOptions {
    db: string;
    limit: string;
    imported?: boolean;
    saved?: boolean;
    client?: string;
    json?: boolean;
}

export function registerListCommand(program: Command): void {
    program
        .command('list')
        .description(
            'List saved sessions in the captures database, newest first. Use `acp-devtools doctor` for live captures (those are not in the database).',
        )
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--limit <n>', 'maximum rows to show', '50')
        .option('--imported', 'only show imported sessions')
        .option('--saved', 'only show non-imported (live-captured) saved sessions')
        .option(
            '--client <substring>',
            'only show sessions whose client name/version/platform matches (case-insensitive)',
        )
        .option('--json', 'emit machine-readable JSON instead of a table')
        .action((opts: ListCommandOptions) => {
            const limit = Number(opts.limit);
            if (!Number.isInteger(limit) || limit < 1) {
                process.stderr.write(`acp-devtools: invalid --limit "${opts.limit}"\n`);
                process.exit(2);
            }
            if (opts.imported && opts.saved) {
                process.stderr.write(
                    'acp-devtools: --imported and --saved are mutually exclusive\n',
                );
                process.exit(2);
            }
            // Filters run in SQL before LIMIT — `--limit n` caps matching rows.
            const filters: SessionFilters = {};
            if (opts.imported) filters.imported = true;
            if (opts.saved) filters.imported = false;
            if (opts.client) filters.client = opts.client;
            const rows = listSessionsSummary(opts.db, limit, filters);

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

const COLUMNS: Column[] = [
    { title: 'ID', align: 'left' },
    { title: 'AGE', align: 'right' },
    { title: 'KIND', align: 'left' },
    { title: 'MSGS', align: 'right' },
    { title: 'SESSION', align: 'left' },
];

function formatTable(rows: SessionSummary[]): string {
    const s = createStyler(colorEnabled(process.stdout));
    const now = Date.now();
    const body = rows.map((r) => {
        const imported = r.imported_at !== null;
        return [
            s.cyan(`#${r.id}`),
            formatAge(now - r.started_at),
            colorSessionKind(s, imported, imported ? 'imported' : 'saved'),
            String(r.message_count),
            labelOf(r),
        ];
    });
    return renderTable(s, COLUMNS, body);
}
