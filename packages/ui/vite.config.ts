import path from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer, type WebSocket as WsType } from 'ws';
import { Session, listActive, openDatabase } from '@acp-devtools/core';

const CAPTURES_DB_PATH = join(
    process.env.ACP_DEVTOOLS_HOME ?? join(homedir(), '.acp-devtools'),
    'captures.db',
);

interface SessionListRow {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    message_count: number;
}

function discoveryPlugin(): PluginOption {
    return {
        name: 'acp-discovery',
        configureServer(server) {
            server.middlewares.use('/api/active', (req, res) => {
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
                    res.end(JSON.stringify({ error: String(err) }));
                }
            });

            server.middlewares.use('/api/sessions', (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.end();
                    return;
                }
                if (!existsSync(CAPTURES_DB_PATH)) {
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ sessions: [] }));
                    return;
                }
                try {
                    const db = openDatabase(CAPTURES_DB_PATH);
                    const rows = db
                        .prepare(
                            `SELECT s.id, s.name, s.agent_command, s.started_at, s.ended_at,
                                (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count
                             FROM sessions s
                             ORDER BY s.started_at DESC
                             LIMIT 200`,
                        )
                        .all() as SessionListRow[];
                    db.close();
                    res.setHeader('content-type', 'application/json');
                    res.setHeader('cache-control', 'no-store');
                    res.end(JSON.stringify({ sessions: rows }));
                } catch (err) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: String(err) }));
                }
            });

            const wss = new WebSocketServer({ noServer: true });
            server.httpServer?.on('upgrade', (req, socket, head) => {
                const url = req.url ?? '';
                const match = url.match(/^\/replay\/(\d+)/);
                if (!match) return;
                const sessionId = Number(match[1]);
                wss.handleUpgrade(req, socket, head, (ws) => {
                    streamReplay(ws, sessionId);
                });
            });
        },
    };
}

function streamReplay(ws: WsType, sessionId: number): void {
    const tag = `[replay #${sessionId}]`;
    if (!existsSync(CAPTURES_DB_PATH)) {
        ws.send(
            JSON.stringify({
                type: 'error',
                message: `no captures.db at ${CAPTURES_DB_PATH}`,
            }),
        );
        ws.close();
        return;
    }
    let db;
    try {
        db = openDatabase(CAPTURES_DB_PATH);
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
        ws.close();
        return;
    }
    let session;
    try {
        session = Session.load(db, sessionId);
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
        ws.close();
        db.close();
        return;
    }

    // Materialise the iterator into an array up-front so we never hold a
    // statement open while we await network/back-pressure. better-sqlite3
    // iterators are read-only over a snapshot, but holding them across many
    // ws.send() calls is fragile when other connections also touch the DB.
    let rows: CapturedMessageLike[];
    try {
        rows = [...session.messages()];
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
        try {
            ws.close();
        } catch {
            // ignore
        }
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
            // eslint-disable-next-line no-console
            console.warn(`${tag} ws.send failed:`, err);
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
    // eslint-disable-next-line no-console
    console.log(
        `${tag} streamed ${sent}/${rows.length} messages · readyState=${ws.readyState}`,
    );
}

type CapturedMessageLike = ReturnType<typeof Session.prototype.messages>['next'] extends () => {
    value: infer V;
}
    ? V
    : unknown;

export default defineConfig({
    plugins: [react(), discoveryPlugin()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        strictPort: false,
        host: '127.0.0.1',
        open: false,
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
