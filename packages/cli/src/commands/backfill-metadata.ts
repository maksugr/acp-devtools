import type { Command } from 'commander';
import {
    type CapturedMessage,
    Session,
    type SqliteDatabase,
    defaultCapturesDbPath,
    extractSessionMetadata,
    openExistingDatabase,
} from '@acp-devtools/core';

interface BackfillOptions {
    db: string;
    json?: boolean;
}

export interface BackfillResult {
    id: number;
    ok: boolean;
    message: string;
    protocolVersion: number | null;
    client: string | null;
    agent: string | null;
}

/**
 * Recompute structured metadata for one session by re-scanning its messages
 * and writing the derived fields back to the row. Exposed for tests; the
 * CLI action wraps this with stdio/exit-code handling.
 */
export function backfillSession(db: SqliteDatabase, id: number): BackfillResult {
    let session: Session;
    try {
        session = Session.load(db, id);
    } catch (err) {
        return {
            id,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
            protocolVersion: null,
            client: null,
            agent: null,
        };
    }
    const messages: CapturedMessage[] = [];
    for (const m of session.messages()) messages.push(m);
    const meta = extractSessionMetadata(messages);
    session.setMetadataFrom(meta);
    // Backfill `client_name` too — proxy normally sets it on the first
    // initialize, but imported sessions arrive without that pass. Same fallback
    // as proxy.detectClient (title → name).
    if (session.info.clientName === null) {
        const inferred = meta.client.title ?? meta.client.name;
        if (inferred !== null) session.setClientName(inferred);
    }
    return {
        id,
        ok: true,
        message: `${messages.length} messages`,
        protocolVersion: session.info.protocolVersion,
        client:
            session.info.clientName ??
            (session.info.clientVersion ? `(v${session.info.clientVersion})` : null),
        agent: session.info.agentName ?? null,
    };
}

export function listSessionIds(db: SqliteDatabase): number[] {
    const rows = db
        .prepare(`SELECT id FROM sessions ORDER BY id ASC`)
        .all() as Array<{ id: number }>;
    return rows.map((r) => r.id);
}

export function registerBackfillMetadataCommand(program: Command): void {
    program
        .command('backfill-metadata')
        .description(
            'Recompute structured session metadata (client/agent/runtime) for saved sessions by re-scanning their captured messages. Used for sessions that pre-date the v4 schema or were imported from JSON.',
        )
        .argument('[id]', 'backfill a single session only (default: all)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--json', 'machine-readable JSON output')
        .action((idArg: string | undefined, opts: BackfillOptions) => {
            let targetId: number | null = null;
            if (idArg !== undefined) {
                targetId = Number(idArg);
                if (!Number.isInteger(targetId) || targetId <= 0) {
                    process.stderr.write(`acp-devtools: invalid id "${idArg}"\n`);
                    process.exit(2);
                }
            }

            let db;
            try {
                db = openExistingDatabase(opts.db);
            } catch (err) {
                process.stderr.write(
                    `acp-devtools: cannot open ${opts.db}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
                process.exit(1);
            }

            const targetIds: number[] =
                targetId !== null ? [targetId] : listSessionIds(db);

            const results: BackfillResult[] = [];
            for (const id of targetIds) results.push(backfillSession(db, id));

            db.close();

            if (opts.json) {
                process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
                return;
            }

            const ok = results.filter((r) => r.ok).length;
            const failed = results.length - ok;
            process.stdout.write(`backfill: ${ok} OK, ${failed} failed\n`);
            for (const r of results) {
                const status = r.ok ? '✓' : '×';
                const proto = r.protocolVersion !== null ? `ACP v${r.protocolVersion}` : '—';
                const client = r.client ?? '—';
                const agent = r.agent ?? '—';
                process.stdout.write(
                    `  ${status}  #${r.id}  ${proto}  client=${client}  agent=${agent}  (${r.message})\n`,
                );
            }
        });
}
