import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { CapturedMessage } from '../acp/types.js';
import type { SessionRecord } from '../storage/session.js';
import type { WsEvent } from './events.js';

export interface WsBroadcasterOptions {
    /** TCP port. Use `0` to bind an ephemeral port (handy in tests). */
    port: number;
    /** Bind address. Defaults to `127.0.0.1` for local-only access. */
    host?: string;
}

/**
 * Local WebSocket fan-out for a single capture session.
 *
 * Lifecycle:
 *  1. `start()` boots the WS server on `host:port`.
 *  2. `publishSessionStart()` records the session and tells all clients.
 *  3. `publishMessage()` is called for each captured frame; the broadcaster
 *     keeps an in-memory log so late connections can be replayed.
 *  4. `publishSessionEnd()` marks completion.
 *  5. `stop()` closes the server and disconnects all clients.
 *
 * Replay command shortcut: call `loadHistory()` before `start()` to seed the
 * broadcaster from a recorded session — new clients receive everything in one
 * go followed by `replay.done`.
 */
export class WsBroadcaster {
    private server: WebSocketServer | null = null;
    private session: SessionRecord | null = null;
    private messages: CapturedMessage[] = [];
    private sessionEnded = false;

    constructor(private readonly options: WsBroadcasterOptions) {}

    /** Start the server. Resolves when it is listening; rejects on bind errors. */
    start(): Promise<{ port: number; url: string }> {
        if (this.server) throw new Error('broadcaster already started');
        return new Promise((resolve, reject) => {
            const host = this.options.host ?? '127.0.0.1';
            const wss = new WebSocketServer({ host, port: this.options.port });
            this.server = wss;

            const onError = (err: Error) => reject(err);
            wss.once('error', onError);
            wss.once('listening', () => {
                wss.off('error', onError);
                wss.on('error', () => undefined);
                wss.on('connection', (ws) => this.onConnection(ws));
                const address = wss.address() as AddressInfo;
                resolve({ port: address.port, url: `ws://${host}:${address.port}` });
            });
        });
    }

    async stop(): Promise<void> {
        const wss = this.server;
        if (!wss) return;
        this.server = null;
        for (const client of wss.clients) client.close(1000, 'shutdown');
        await Promise.race([
            new Promise<void>((resolve) => wss.close(() => resolve())),
            new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
        for (const client of wss.clients) client.terminate();
    }

    publishSessionStart(session: SessionRecord): void {
        this.session = session;
        this.messages = [];
        this.sessionEnded = false;
        this.broadcast({ type: 'session.start', session });
    }

    publishMessage(message: CapturedMessage): void {
        if (!this.session) {
            throw new Error('publishMessage called before publishSessionStart');
        }
        this.messages.push(message);
        this.broadcast({ type: 'message', message });
    }

    publishSessionEnd(session: SessionRecord): void {
        this.session = session;
        this.sessionEnded = true;
        this.broadcast({ type: 'session.end', session });
    }

    /**
     * Pre-load a finished session for the replay command. Must be called before
     * clients connect; live `publish*` calls afterwards are not supported.
     */
    loadHistory(session: SessionRecord, messages: Iterable<CapturedMessage>): void {
        this.session = session;
        this.messages = [...messages];
        this.sessionEnded = session.endedAt !== null;
    }

    private onConnection(ws: WebSocket): void {
        if (this.session) {
            this.send(ws, { type: 'session.start', session: this.session });
            for (const m of this.messages) {
                this.send(ws, { type: 'message', message: m });
            }
            this.send(ws, { type: 'replay.done' });
            if (this.sessionEnded) {
                this.send(ws, { type: 'session.end', session: this.session });
            }
        }
    }

    private broadcast(event: WsEvent): void {
        const wss = this.server;
        if (!wss) return;
        const data = JSON.stringify(event);
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(data);
        }
    }

    private send(ws: WebSocket, event: WsEvent): void {
        ws.send(JSON.stringify(event));
    }
}
