import type { Command } from 'commander';
import {
    Session,
    defaultCapturesDbPath,
    listSessionsSummary,
    openDatabase,
} from '@acp-devtools/core';

interface SearchCommandOptions {
    db: string;
    limit: string;
    session?: string;
    inMethod?: boolean;
    inPayload?: boolean;
    json?: boolean;
}

interface Hit {
    sessionId: number;
    seq: number;
    method: string | null;
    snippet: string;
}

export function registerSearchCommand(program: Command): void {
    program
        .command('search')
        .description(
            'Find messages containing a substring across every saved session. Substring match is case-insensitive. Use `inspect` to read individual messages once you know where to look.',
        )
        .argument('<query>', 'substring to search for (case-insensitive)')
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--limit <n>', 'maximum hits to print', '50')
        .option('--session <id>', 'restrict search to a single session')
        .option('--in-method', 'match only method names (default: match anywhere in the raw frame)')
        .option('--in-payload', 'match only inside the payload (skip method-only hits)')
        .option('--json', 'emit machine-readable JSON instead of a table')
        .action((query: string, opts: SearchCommandOptions) => {
            const limit = Number(opts.limit);
            if (!Number.isInteger(limit) || limit < 1) {
                process.stderr.write(`acp-devtools: invalid --limit "${opts.limit}"\n`);
                process.exit(2);
            }
            const needle = query.toLowerCase();
            if (needle.length === 0) {
                process.stderr.write('acp-devtools: empty query\n');
                process.exit(2);
            }

            let sessionIds: number[];
            if (opts.session !== undefined) {
                const id = Number(opts.session);
                if (!Number.isInteger(id) || id <= 0) {
                    process.stderr.write(`acp-devtools: invalid --session "${opts.session}"\n`);
                    process.exit(2);
                }
                sessionIds = [id];
            } else {
                sessionIds = listSessionsSummary(opts.db, 10_000).map((s) => s.id);
            }

            let db;
            try {
                db = openDatabase(opts.db);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: cannot open ${opts.db}: ${msg}\n`);
                process.exit(1);
            }

            const hits: Hit[] = [];
            outer: for (const sid of sessionIds) {
                let session: Session;
                try {
                    session = Session.load(db, sid);
                } catch {
                    continue; // session vanished mid-iteration; skip silently
                }
                for (const m of session.messages()) {
                    if (hits.length >= limit) break outer;
                    const inMethod = m.method?.toLowerCase().includes(needle) ?? false;
                    const inRaw = m.raw.toLowerCase().includes(needle);
                    if (opts.inMethod && !inMethod) continue;
                    if (opts.inPayload && !inRaw) continue;
                    if (!opts.inMethod && !opts.inPayload && !inMethod && !inRaw) continue;
                    hits.push({
                        sessionId: sid,
                        seq: m.seq,
                        method: m.method ?? null,
                        snippet: makeSnippet(m.raw, needle),
                    });
                }
            }
            db.close();

            if (opts.json) {
                process.stdout.write(JSON.stringify(hits, null, 2) + '\n');
                return;
            }
            if (hits.length === 0) {
                process.stdout.write('no matches\n');
                return;
            }
            process.stdout.write(renderHits(hits));
        });
}

const SNIPPET_LEN = 80;

function makeSnippet(raw: string, needle: string): string {
    const idx = raw.toLowerCase().indexOf(needle);
    if (idx < 0) return raw.slice(0, SNIPPET_LEN);
    // Show ~30 chars of context before the hit so the user sees where it sits.
    const start = Math.max(0, idx - 30);
    const end = Math.min(raw.length, start + SNIPPET_LEN);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < raw.length ? '…' : '';
    return prefix + raw.slice(start, end).replace(/\s+/g, ' ') + suffix;
}

function renderHits(hits: Hit[]): string {
    const widths = {
        loc: Math.max(7, ...hits.map((h) => `#${h.sessionId}/${h.seq}`.length)),
        method: Math.min(
            32,
            Math.max(6, ...hits.map((h) => (h.method ?? '—').length)),
        ),
    };
    return (
        hits
            .map((h) => {
                const loc = `#${h.sessionId}/${h.seq}`;
                const method = h.method ?? '—';
                return (
                    [
                        loc.padEnd(widths.loc),
                        truncate(method, widths.method).padEnd(widths.method),
                        h.snippet,
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
