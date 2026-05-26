import { existsSync } from 'node:fs';
import { openDatabase } from '../storage/sqlite.js';

export interface SessionSummary {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    message_count: number;
    client_name: string | null;
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
                `SELECT s.id, s.name, s.agent_command, s.started_at, s.ended_at, s.client_name,
                    (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count
                 FROM sessions s
                 ORDER BY s.started_at DESC
                 LIMIT ?`,
            )
            .all(limit) as SessionSummary[];
    } finally {
        db.close();
    }
}
