import type { Command } from 'commander';
import {
    defaultCapturesDbPath,
    deleteSession,
    listSessionsSummary,
} from '@acp-devtools/core';

interface DeleteCommandOptions {
    db: string;
}

export function registerDeleteCommand(program: Command): void {
    program
        .command('delete')
        .description(
            'Delete one or more saved sessions from captures.db forever. Cascades to messages via the schema. No interactive prompt — pair with `acp-devtools list` to verify ids before invoking.',
        )
        .argument('<id...>', 'one or more session ids to delete')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .action((rawIds: string[], opts: DeleteCommandOptions) => {
            const ids: number[] = [];
            for (const raw of rawIds) {
                const id = Number(raw);
                if (!Number.isInteger(id) || id <= 0) {
                    process.stderr.write(`acp-devtools: invalid id "${raw}"\n`);
                    process.exit(2);
                }
                ids.push(id);
            }
            // Look up labels BEFORE deletion so the status line can show what
            // we removed without a second query per id.
            const summaries = listSessionsSummary(opts.db, 10_000);
            const byId = new Map(summaries.map((s) => [s.id, s]));

            let missing = 0;
            for (const id of ids) {
                const summary = byId.get(id);
                const removed = deleteSession(opts.db, id);
                if (!removed) {
                    process.stderr.write(`acp-devtools: #${id} not found\n`);
                    missing += 1;
                    continue;
                }
                const label = labelFor(summary);
                const msgs = summary?.message_count ?? 0;
                const noun = msgs === 1 ? 'message' : 'messages';
                process.stderr.write(
                    `acp-devtools: deleted #${id}${label ? ` ${label}` : ''} (${msgs} ${noun})\n`,
                );
            }
            if (missing > 0) process.exit(1);
        });
}

function labelFor(s: { name: string | null; client_name: string | null; agent_command: string | null } | undefined): string {
    if (!s) return '';
    if (s.name) return s.name;
    if (s.client_name && s.agent_command) return `${s.client_name} · ${s.agent_command}`;
    if (s.client_name) return s.client_name;
    return s.agent_command ?? '';
}
