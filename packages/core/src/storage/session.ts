import type { Statement } from 'better-sqlite3';
import { extractSessionMetadata, type SessionMetadata } from '../acp/session-metadata.js';
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
    /**
     * Wall-clock when this session was inserted via `POST /api/import` (or
     * `insertImportedSession` in the server module). NULL for live captures
     * and CLI-saved sessions — the UI uses non-null to flip the mode label
     * from LIVE/REPLAY to IMPORTED and to render the FILE pill.
     */
    importedAt: number | null;
    /** `clientInfo.version` from initialize — e.g. `"1.3.5+stable.285"`. */
    clientVersion: string | null;
    /** `clientInfo._meta.platform` — JetBrains uses `"intellij"`. */
    clientPlatform: string | null;
    /** Agent name from initialize response (`result.agentInfo.name`). */
    agentName: string | null;
    /** Agent version from initialize response. */
    agentVersion: string | null;
    /** Negotiated ACP protocol version. */
    protocolVersion: number | null;
    /** Latest observed `session/set_mode.params.modeId` (or `current_mode_update`). */
    currentMode: string | null;
    /** Latest observed `session/set_model.params.modelId`. */
    currentModel: string | null;
    /** JSON-stringified `result.agentCapabilities` from initialize response. */
    agentCapabilitiesJson: string | null;
}

export interface StartSessionOptions {
    name?: string;
    agentCommand?: string;
    startedAt?: number;
    importedAt?: number;
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

interface SessionRow {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    client_name: string | null;
    imported_at: number | null;
    client_version: string | null;
    client_platform: string | null;
    agent_name: string | null;
    agent_version: string | null;
    protocol_version: number | null;
    current_mode: string | null;
    current_model: string | null;
    agent_capabilities_json: string | null;
}

const SESSION_SELECT = `SELECT id, name, agent_command, started_at, ended_at,
    client_name, imported_at, client_version, client_platform,
    agent_name, agent_version, protocol_version, current_mode, current_model,
    agent_capabilities_json
    FROM sessions`;

function rowToInfo(row: SessionRow): SessionRecord {
    return {
        id: row.id,
        name: row.name,
        agentCommand: row.agent_command,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        clientName: row.client_name,
        importedAt: row.imported_at,
        clientVersion: row.client_version,
        clientPlatform: row.client_platform,
        agentName: row.agent_name,
        agentVersion: row.agent_version,
        protocolVersion: row.protocol_version,
        currentMode: row.current_mode,
        currentModel: row.current_model,
        agentCapabilitiesJson: row.agent_capabilities_json,
    };
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
        const importedAt = options.importedAt ?? null;
        const stmt = db.prepare(
            `INSERT INTO sessions (name, agent_command, started_at, imported_at) VALUES (?, ?, ?, ?)`,
        );
        const result = stmt.run(
            options.name ?? null,
            options.agentCommand ?? null,
            startedAt,
            importedAt,
        );
        const id = Number(result.lastInsertRowid);
        return new Session(db, {
            id,
            name: options.name ?? null,
            agentCommand: options.agentCommand ?? null,
            startedAt,
            endedAt: null,
            clientName: null,
            importedAt,
            clientVersion: null,
            clientPlatform: null,
            agentName: null,
            agentVersion: null,
            protocolVersion: null,
            currentMode: null,
            currentModel: null,
            agentCapabilitiesJson: null,
        });
    }

    static load(db: SqliteDatabase, sessionId: number): Session {
        const row = db
            .prepare(`${SESSION_SELECT} WHERE id = ?`)
            .get(sessionId) as SessionRow | undefined;
        if (!row) throw new Error(`session ${sessionId} not found`);
        return new Session(db, rowToInfo(row));
    }

    static latest(db: SqliteDatabase): Session {
        const row = db
            .prepare(`${SESSION_SELECT} ORDER BY id DESC LIMIT 1`)
            .get() as SessionRow | undefined;
        if (!row) throw new Error('database has no sessions');
        return new Session(db, rowToInfo(row));
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

    /**
     * Write the structured-metadata columns from a derived `SessionMetadata`.
     * Used by:
     * - The proxy on every metadata-relevant message (initialize, set_mode,
     *   set_model, current_mode_update) so the UI's SessionPicker can label
     *   `#21 · Zed 1.3.5 · claude-agent-acp 0.37.0` mid-session.
     * - The `backfill-metadata` CLI command for pre-v4 / imported sessions.
     *
     * Idempotent — running on the same messages produces the same writes.
     */
    setMetadataFromMessages(messages: CapturedMessage[]): void {
        this.setMetadataFrom(extractSessionMetadata(messages));
    }

    setMetadataFrom(meta: SessionMetadata): void {
        const agentCapsJson = JSON.stringify(meta.agentCapabilities);
        this.db
            .prepare(
                `UPDATE sessions SET
                    client_version = ?,
                    client_platform = ?,
                    agent_name = ?,
                    agent_version = ?,
                    protocol_version = ?,
                    current_mode = ?,
                    current_model = ?,
                    agent_capabilities_json = ?
                WHERE id = ?`,
            )
            .run(
                meta.client.version,
                meta.client.platform,
                meta.agent.name,
                meta.agent.version,
                meta.protocolVersion,
                meta.runtime.currentMode,
                meta.runtime.currentModel,
                agentCapsJson,
                this.info.id,
            );
        this.info = {
            ...this.info,
            clientVersion: meta.client.version,
            clientPlatform: meta.client.platform,
            agentName: meta.agent.name,
            agentVersion: meta.agent.version,
            protocolVersion: meta.protocolVersion,
            currentMode: meta.runtime.currentMode,
            currentModel: meta.runtime.currentModel,
            agentCapabilitiesJson: agentCapsJson,
        };
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
