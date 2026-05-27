import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Session } from '../storage/session.js';
import { openDatabase } from '../storage/sqlite.js';
import type { SessionExport } from '../storage/export.js';

export interface SessionSummary {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    message_count: number;
    client_name: string | null;
    imported_at: number | null;
    client_version: string | null;
    client_platform: string | null;
    agent_name: string | null;
    agent_version: string | null;
    protocol_version: number | null;
    current_mode: string | null;
    current_model: string | null;
}

/**
 * Return all sessions in the given captures.db with their message counts,
 * newest first. Returns an empty list if the file does not exist — the UI
 * surfaces this as "no saved sessions yet" rather than an error.
 */
export function listSessionsSummary(dbPath: string, limit = 200): SessionSummary[] {
    if (!existsSync(dbPath)) return [];
    const db = openDatabase(dbPath);
    try {
        return db
            .prepare(
                // Sort by "when did this session show up in THIS db" — for live
                // captures that's `started_at`; for imports, `imported_at` (the
                // moment the row was inserted via POST /api/import). Otherwise
                // a freshly imported session whose source had an old
                // `started_at` would sink into the middle of the picker, even
                // though the user just added it.
                `SELECT s.id, s.name, s.agent_command, s.started_at, s.ended_at,
                    s.client_name, s.imported_at,
                    s.client_version, s.client_platform,
                    s.agent_name, s.agent_version, s.protocol_version,
                    s.current_mode, s.current_model,
                    (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count
                 FROM sessions s
                 ORDER BY COALESCE(s.imported_at, s.started_at) DESC
                 LIMIT ?`,
            )
            .all(limit) as SessionSummary[];
    } finally {
        db.close();
    }
}

/**
 * Find sessions whose stored client metadata matches the given client name
 * (case-insensitive substring). Useful for MCP tools like
 * `find_sessions_by_client('WebStorm')` — relies on Phase C structured
 * columns being populated (by the proxy live, or by `backfill-metadata`
 * for older captures).
 *
 * `limit` is the cap on **results** returned, not the pre-filter pool.
 * A small limit (e.g. 3 from an MCP caller) used to bypass any WebStorm
 * session if the three newest happened to be Zed — fixed by fetching a
 * generous pool first, then trimming.
 */
const FIND_BY_CLIENT_POOL_SIZE = 500;

export function findSessionsByClient(
    dbPath: string,
    needle: string,
    limit = 200,
): SessionSummary[] {
    const pool = listSessionsSummary(dbPath, FIND_BY_CLIENT_POOL_SIZE);
    const lower = needle.toLowerCase();
    const matches = pool.filter((s) => {
        const candidates = [s.client_name, s.client_version, s.client_platform].filter(
            (v): v is string => typeof v === 'string',
        );
        return candidates.some((c) => c.toLowerCase().includes(lower));
    });
    return matches.slice(0, limit);
}

export interface InsertImportResult {
    /** The new session id assigned by SQLite — does NOT reuse `export.session.id`. */
    id: number;
    messageCount: number;
}

/**
 * Insert a `SessionExport` as a brand-new session in `captures.db`. The new
 * row gets a fresh autoincrement id; original metadata (clientName, agent,
 * timestamps, name) is preserved. The session name defaults to the source
 * filename so picker labels make sense without extra UI logic.
 */
export function insertImportedSession(
    dbPath: string,
    exp: SessionExport,
    options: { sourceFilename?: string } = {},
): InsertImportResult {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = openDatabase(dbPath);
    try {
        const name = exp.session.name ?? options.sourceFilename ?? null;
        const sessionStartOpts: Parameters<typeof Session.start>[1] = {
            startedAt: exp.session.startedAt,
            importedAt: Date.now(),
        };
        if (name !== null) sessionStartOpts.name = name;
        if (exp.session.agentCommand !== null) {
            sessionStartOpts.agentCommand = exp.session.agentCommand;
        }
        const session = Session.start(db, sessionStartOpts);
        if (exp.session.clientName !== null) {
            session.setClientName(exp.session.clientName);
        }
        for (const msg of exp.messages) {
            session.record(msg);
        }
        session.close(exp.session.endedAt ?? Date.now());
        return { id: session.info.id, messageCount: exp.messages.length };
    } finally {
        db.close();
    }
}

/**
 * Delete a session and all its messages from `captures.db`. Returns true if
 * the row existed, false otherwise. The `ON DELETE CASCADE` on `messages`
 * means a single statement is enough.
 */
export function deleteSession(dbPath: string, sessionId: number): boolean {
    if (!existsSync(dbPath)) return false;
    const db = openDatabase(dbPath);
    try {
        const info = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        return info.changes > 0;
    } finally {
        db.close();
    }
}
