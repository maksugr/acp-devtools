import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT,
    agent_command TEXT,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    timestamp    INTEGER NOT NULL,
    direction    TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    method       TEXT,
    rpc_id       TEXT,
    raw          TEXT    NOT NULL,
    payload_json TEXT,
    parse_error  TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_session_rpc ON messages(session_id, rpc_id);
`;

/**
 * Open (or create) the acp-devtools session database and run schema migrations.
 *
 * Pass `:memory:` for an in-memory database (useful in tests).
 */
export function openDatabase(path: string): SqliteDatabase {
    const db = new Database(path);
    // busy_timeout MUST be set before any pragma that needs an exclusive lock
    // (journal_mode=WAL, schema migrations) — otherwise concurrent processes
    // opening the same captures.db race on the upgrade and one immediately
    // throws SQLITE_BUSY instead of waiting.
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    return db;
}

export function getSchemaVersion(db: SqliteDatabase): number {
    const row = db.pragma('user_version', { simple: true });
    return typeof row === 'number' ? row : Number(row);
}

export { SCHEMA_VERSION };
