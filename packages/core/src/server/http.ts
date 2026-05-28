import { existsSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { listActive } from '../discovery/registry.js';
import { ExportParseError, parseExport } from '../storage/export.js';
import { Session } from '../storage/session.js';
import { openDatabase } from '../storage/sqlite.js';
import { deleteSession, insertImportedSession, listSessionsSummary } from './queries.js';
import { streamReplay } from './replay.js';

export interface ApiHandlerOptions {
    /** Path to the shared captures.db used for the `/api/sessions` endpoint. */
    capturesDbPath: string;
    /**
     * Absolute path to the running acp-devtools binary, exposed via
     * `/api/info` so the UI can pre-fill copy-paste IDE snippets without
     * the user having to look it up. Null in dev (Vite middleware), where
     * `process.argv[1]` points at vite itself.
     */
    binaryPath?: string | null;
}

/**
 * Create a Node-http request handler that serves the acp-devtools discovery
 * endpoints: `GET /api/active`, `GET /api/sessions`, `GET /api/info`. Returns
 * `true` if the request was handled, `false` if the caller should continue
 * routing (e.g. to a static file server).
 */
export function createApiHandler(options: ApiHandlerOptions) {
    return (req: IncomingMessage, res: ServerResponse): boolean => {
        const url = req.url ?? '';
        const path = url.split('?')[0];
        if (path === '/api/active') {
            handleActive(req, res);
            return true;
        }
        if (path === '/api/sessions') {
            handleSessions(req, res, options.capturesDbPath);
            return true;
        }
        if (path === '/api/info') {
            handleInfo(req, res, options.binaryPath ?? null);
            return true;
        }
        if (path === '/api/import') {
            handleImport(req, res, options.capturesDbPath);
            return true;
        }
        const messagesMatch = path?.match(/^\/api\/sessions\/(\d+)\/messages$/);
        if (messagesMatch) {
            handleSessionMessages(req, res, options.capturesDbPath, Number(messagesMatch[1]));
            return true;
        }
        const sessionMatch = path?.match(/^\/api\/sessions\/(\d+)$/);
        if (sessionMatch) {
            handleSessionItem(req, res, options.capturesDbPath, Number(sessionMatch[1]));
            return true;
        }
        return false;
    };
}

function handleActive(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
    }
    try {
        const captures = listActive();
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ captures }));
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
    }
}

function handleInfo(req: IncomingMessage, res: ServerResponse, binaryPath: string | null): void {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
    }
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(
        JSON.stringify({
            binaryPath,
            platform: process.platform,
            arch: process.arch,
        }),
    );
}

function handleSessions(req: IncomingMessage, res: ServerResponse, dbPath: string): void {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
    }
    try {
        const sessions = listSessionsSummary(dbPath);
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ sessions }));
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
    }
}

function handleSessionItem(
    req: IncomingMessage,
    res: ServerResponse,
    dbPath: string,
    sessionId: number,
): void {
    if (req.method !== 'DELETE') {
        res.statusCode = 405;
        res.setHeader('allow', 'DELETE');
        res.end();
        return;
    }
    try {
        const removed = deleteSession(dbPath, sessionId);
        if (!removed) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: `session ${sessionId} not found` }));
            return;
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ id: sessionId, deleted: true }));
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
}

/**
 * `GET /api/sessions/:id/messages` — the full ordered frame list for one saved
 * session, plus its `SessionRecord`. The replay WS streams frames for the live
 * timeline; the DiffPanel needs the whole set at once to align against the
 * current session, so this is a plain one-shot JSON fetch.
 */
function handleSessionMessages(
    req: IncomingMessage,
    res: ServerResponse,
    dbPath: string,
    sessionId: number,
): void {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET');
        res.end();
        return;
    }
    if (!existsSync(dbPath)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: `session ${sessionId} not found` }));
        return;
    }
    let db;
    try {
        db = openDatabase(dbPath);
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
    }
    try {
        const session = Session.load(db, sessionId);
        const messages = [...session.messages()];
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ session: session.info, messages }));
    } catch (err) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } finally {
        db.close();
    }
}

const IMPORT_MAX_BYTES = 64 * 1024 * 1024; // 64MB ceiling — a busy 2-hour capture is ~20MB

function handleImport(req: IncomingMessage, res: ServerResponse, dbPath: string): void {
    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('allow', 'POST');
        res.end();
        return;
    }
    const sourceFilename = readSourceFilename(req);
    const chunks: Buffer[] = [];
    let received = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
        if (rejected) return;
        received += chunk.length;
        if (received > IMPORT_MAX_BYTES) {
            rejected = true;
            res.statusCode = 413;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    error: `import payload exceeds ${IMPORT_MAX_BYTES} bytes`,
                }),
            );
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (rejected) return;
        const body = Buffer.concat(chunks).toString('utf8');
        try {
            const exp = parseExport(body);
            const opts: { sourceFilename?: string } = {};
            if (sourceFilename) opts.sourceFilename = sourceFilename;
            const result = insertImportedSession(dbPath, exp, opts);
            res.statusCode = 201;
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(result));
        } catch (err) {
            const isClientError = err instanceof ExportParseError;
            res.statusCode = isClientError ? 400 : 500;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                }),
            );
        }
    });
    req.on('error', (err) => {
        if (rejected) return;
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
    });
}

function readSourceFilename(req: IncomingMessage): string | null {
    const header = req.headers['x-acp-source-filename'];
    if (typeof header === 'string' && header.length > 0 && header.length < 256) {
        // Strip any path components — only the bare filename is useful as a label.
        const last = header.split(/[\\/]/).pop() ?? '';
        return last || null;
    }
    return null;
}

export interface ReplayUpgradeOptions {
    capturesDbPath: string;
}

/**
 * Attach a `/replay/<id>` WebSocket endpoint to an existing HTTP server.
 * Connecting clients receive the saved session via {@link streamReplay} and
 * then the socket closes. Unmatched upgrade requests are ignored — the caller
 * may register additional `upgrade` handlers for other paths.
 */
export function attachReplayUpgrade(httpServer: HttpServer, options: ReplayUpgradeOptions): void {
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = req.url ?? '';
        const match = url.match(/^\/replay\/(\d+)/);
        if (!match) return;
        const sessionId = Number(match[1]);
        wss.handleUpgrade(req, socket, head, (ws) => {
            streamReplay(ws, sessionId, options.capturesDbPath);
        });
    });
}
