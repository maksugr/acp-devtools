import type { Statement } from 'better-sqlite3';
import type { CapturedMessage, JsonRpcMessage } from '../acp/types.js';
import type { SqliteDatabase } from './sqlite.js';

export interface SessionRecord {
    id: number;
    name: string | null;
    agentCommand: string | null;
    startedAt: number;
    endedAt: number | null;
    /**
     * Human-readable client identifier extracted from the first `initialize`
     * request's `params.clientInfo.title` — e.g. `"Zed"` or
     * `"WebStorm 2026.1.2"`. Null until the first frame is seen.
     */
    clientName: string | null;
}

export interface StartSessionOptions {
    name?: string;
    agentCommand?: string;
    startedAt?: number;
}

interface MessageRow {
    seq: number;
    timestamp: number;
    direction: string;
    kind: string;
    method: string | null;
    rpc_id: string | null;
    raw: string;
    payload_json: string | null;
    parse_error: string | null;
}

function rowToMessage(row: MessageRow): CapturedMessage {
    const msg: CapturedMessage = {
        seq: row.seq,
        timestamp: row.timestamp,
        direction: row.direction as CapturedMessage['direction'],
        kind: row.kind as CapturedMessage['kind'],
        raw: row.raw,
        payload: row.payload_json
            ? (JSON.parse(row.payload_json) as JsonRpcMessage)
            : null,
    };
    if (row.method !== null) msg.method = row.method;
    if (row.rpc_id !== null) msg.rpcId = parseRpcId(row.rpc_id);
    if (row.parse_error !== null) msg.parseError = row.parse_error;
    return msg;
}

function parseRpcId(stored: string): string | number {
    const asNum = Number(stored);
    return Number.isFinite(asNum) && String(asNum) === stored ? asNum : stored;
}

/**
 * High-level wrapper around a single ACP capture session in SQLite.
 *
 * Owns one row in `sessions` and inserts each `CapturedMessage` into `messages`.
 * Inserts are batched per call but every call commits immediately so a crash
 * does not lose more than the in-flight message.
 */
export class Session {
    private readonly insertStmt: Statement;
    private readonly endStmt: Statement;
    private readonly listStmt: Statement;

    constructor(
        private readonly db: SqliteDatabase,
        public info: SessionRecord,
    ) {
        this.insertStmt = db.prepare(
            `INSERT INTO messages (
                session_id, seq, timestamp, direction, kind,
                method, rpc_id, raw, payload_json, parse_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        this.endStmt = db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`);
        this.listStmt = db.prepare(
            `SELECT seq, timestamp, direction, kind, method, rpc_id, raw, payload_json, parse_error
             FROM messages WHERE session_id = ? ORDER BY seq ASC`,
        );
    }

    static start(db: SqliteDatabase, options: StartSessionOptions = {}): Session {
        const startedAt = options.startedAt ?? Date.now();
        const stmt = db.prepare(
            `INSERT INTO sessions (name, agent_command, started_at) VALUES (?, ?, ?)`,
        );
        const result = stmt.run(options.name ?? null, options.agentCommand ?? null, startedAt);
        const id = Number(result.lastInsertRowid);
        return new Session(db, {
            id,
            name: options.name ?? null,
            agentCommand: options.agentCommand ?? null,
            startedAt,
            endedAt: null,
            clientName: null,
        });
    }

    static load(db: SqliteDatabase, sessionId: number): Session {
        const row = db
            .prepare(
                `SELECT id, name, agent_command, started_at, ended_at, client_name FROM sessions WHERE id = ?`,
            )
            .get(sessionId) as
            | {
                  id: number;
                  name: string | null;
                  agent_command: string | null;
                  started_at: number;
                  ended_at: number | null;
                  client_name: string | null;
              }
            | undefined;
        if (!row) throw new Error(`session ${sessionId} not found`);
        return new Session(db, {
            id: row.id,
            name: row.name,
            agentCommand: row.agent_command,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            clientName: row.client_name,
        });
    }

    static latest(db: SqliteDatabase): Session {
        const row = db
            .prepare(
                `SELECT id, name, agent_command, started_at, ended_at, client_name FROM sessions ORDER BY id DESC LIMIT 1`,
            )
            .get() as
            | {
                  id: number;
                  name: string | null;
                  agent_command: string | null;
                  started_at: number;
                  ended_at: number | null;
                  client_name: string | null;
              }
            | undefined;
        if (!row) throw new Error('database has no sessions');
        return new Session(db, {
            id: row.id,
            name: row.name,
            agentCommand: row.agent_command,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            clientName: row.client_name,
        });
    }

    /**
     * Persist a detected client name on the session row. Called once when the
     * first `initialize` request is seen by the proxy. Subsequent calls
     * overwrite — the latest title wins.
     */
    setClientName(name: string): void {
        this.db
            .prepare(`UPDATE sessions SET client_name = ? WHERE id = ?`)
            .run(name, this.info.id);
        this.info = { ...this.info, clientName: name };
    }

    record(message: CapturedMessage): void {
        this.insertStmt.run(
            this.info.id,
            message.seq,
            message.timestamp,
            message.direction,
            message.kind,
            message.method ?? null,
            message.rpcId === undefined || message.rpcId === null ? null : String(message.rpcId),
            message.raw,
            message.payload ? JSON.stringify(message.payload) : null,
            message.parseError ?? null,
        );
    }

    close(endedAt: number = Date.now()): void {
        this.endStmt.run(endedAt, this.info.id);
        this.info = { ...this.info, endedAt };
    }

    *messages(): IterableIterator<CapturedMessage> {
        for (const row of this.listStmt.iterate(this.info.id) as IterableIterator<MessageRow>) {
            yield rowToMessage(row);
        }
    }
}
