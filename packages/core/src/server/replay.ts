import { existsSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { Session } from '../storage/session.js';
import { openDatabase } from '../storage/sqlite.js';

interface ReplayLogger {
    log: (message: string) => void;
    warn: (message: string, err?: unknown) => void;
}

const DEFAULT_LOGGER: ReplayLogger = {
    log: (message) => {
        console.log(message);
    },
    warn: (message, err) => {
        console.warn(message, err);
    },
};

/**
 * Stream a saved session to a connected WebSocket using the same wire format
 * as {@link WsBroadcaster}: `session.start` → N × `message` → `replay.done` →
 * optional `session.end`. Closes the socket on completion or error.
 *
 * The function is intentionally self-contained so it works both in Vite's dev
 * middleware and in the `acp-devtools ui` HTTP server.
 */
export function streamReplay(
    ws: WebSocket,
    sessionId: number,
    dbPath: string,
    logger: ReplayLogger = DEFAULT_LOGGER,
): void {
    const tag = `[replay #${sessionId}]`;
    if (!existsSync(dbPath)) {
        sendError(ws, `no captures.db at ${dbPath}`);
        safeClose(ws);
        return;
    }
    let db;
    try {
        db = openDatabase(dbPath);
    } catch (err) {
        sendError(ws, String(err));
        safeClose(ws);
        return;
    }
    let session: Session;
    try {
        session = Session.load(db, sessionId);
    } catch (err) {
        sendError(ws, String(err));
        safeClose(ws);
        db.close();
        return;
    }

    // Materialise into an array up-front so we never hold a sqlite statement
    // open while we await network back-pressure. better-sqlite3 iterators are
    // read-only over a snapshot, but holding them across many ws.send() calls
    // is fragile when other connections also touch the DB concurrently.
    let rows;
    try {
        rows = [...session.messages()];
    } catch (err) {
        sendError(ws, String(err));
        safeClose(ws);
        db.close();
        return;
    }
    db.close();

    const sendSafe = (payload: unknown): boolean => {
        if (ws.readyState !== ws.OPEN) return false;
        try {
            ws.send(JSON.stringify(payload));
            return true;
        } catch (err) {
            logger.warn(`${tag} ws.send failed:`, err);
            return false;
        }
    };

    sendSafe({ type: 'session.start', session: session.info });
    let sent = 0;
    for (const m of rows) {
        if (!sendSafe({ type: 'message', message: m })) break;
        sent += 1;
    }
    sendSafe({ type: 'replay.done' });
    if (session.info.endedAt !== null) {
        sendSafe({ type: 'session.end', session: session.info });
    }
    logger.log(`${tag} streamed ${sent}/${rows.length} messages · readyState=${ws.readyState}`);
}

function sendError(ws: WebSocket, message: string): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
        ws.send(JSON.stringify({ type: 'error', message }));
    } catch {
        // ignore
    }
}

function safeClose(ws: WebSocket): void {
    try {
        ws.close();
    } catch {
        // ignore
    }
}
