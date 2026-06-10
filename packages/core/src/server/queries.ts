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

export interface SessionFilters {
    /** Case-insensitive substring over client name / version / platform. */
    client?: string;
    /** true → only imported sessions; false → only live-captured; omit → both. */
    imported?: boolean;
}

/**
 * Return sessions in the given captures.db with their message counts, newest
 * first. Filters are part of the SQL WHERE, so `limit` caps the *matching*
 * rows — `{ imported: true }` with limit 5 returns the 5 newest imported
 * sessions, not "imported among the 5 newest overall". Returns an empty list
 * if the file does not exist — the UI surfaces this as "no saved sessions
 * yet" rather than an error.
 */
export function listSessionsSummary(
    dbPath: string,
    limit = 200,
    filters: SessionFilters = {},
): SessionSummary[] {
    if (!existsSync(dbPath)) return [];
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.imported === true) where.push('s.imported_at IS NOT NULL');
    if (filters.imported === false) where.push('s.imported_at IS NULL');
    if (filters.client) {
        // instr() instead of LIKE — substring match without %/_ escaping.
        where.push(
            `(instr(lower(coalesce(s.client_name, '')), ?)
              + instr(lower(coalesce(s.client_version, '')), ?)
              + instr(lower(coalesce(s.client_platform, '')), ?)) > 0`,
        );
        const needle = filters.client.toLowerCase();
        params.push(needle, needle, needle);
    }
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
                 ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY COALESCE(s.imported_at, s.started_at) DESC
                 LIMIT ?`,
            )
            .all(...params, limit) as SessionSummary[];
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
 * `limit` caps the **matching** rows: the filter runs in SQL before LIMIT,
 * so a small limit (e.g. 3 from an MCP caller) still finds WebStorm
 * sessions even when the newest captures are all Zed.
 */
export function findSessionsByClient(
    dbPath: string,
    needle: string,
    limit = 200,
): SessionSummary[] {
    return listSessionsSummary(dbPath, limit, { client: needle });
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
