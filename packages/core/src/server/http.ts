import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { listActive } from '../discovery/registry.js';
import { listSessionsSummary } from './queries.js';
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
