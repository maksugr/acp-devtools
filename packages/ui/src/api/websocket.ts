import type { WsEvent } from '@acp-devtools/core';
import { useMessagesStore } from '../store/messagesStore';

const DEFAULT_URL = 'ws://127.0.0.1:3737';
const RECONNECT_DELAY_MS = 1500;
const MAX_BACKOFF_MS = 12000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let manuallyClosed = false;
let currentUrl = DEFAULT_URL;
let openedOnce = false;

function scheduleReconnect(): void {
    if (manuallyClosed) return;
    const delay = Math.min(MAX_BACKOFF_MS, RECONNECT_DELAY_MS * Math.pow(1.6, attempt));
    attempt += 1;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(currentUrl);
    }, delay);
}

export function connect(url: string = DEFAULT_URL): void {
    if (socket) {
        try {
            socket.close();
        } catch {
            // ignore
        }
        socket = null;
    }
    manuallyClosed = false;
    currentUrl = url;
    const store = useMessagesStore.getState();
    // While reconnecting we stay in a single steady state instead of flipping
    // connecting → error → closed → connecting on every backoff tick — that
    // visual flutter reads as "jittering" in the UI.
    if (store.connection !== 'connecting') {
        store.setConnection('connecting');
    }

    let ws: WebSocket;
    try {
        ws = new WebSocket(url);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.setConnection('connecting', msg);
        scheduleReconnect();
        return;
    }
    socket = ws;

    ws.addEventListener('open', () => {
        attempt = 0;
        openedOnce = true;
        useMessagesStore.getState().setConnection('open');
    });

    ws.addEventListener('message', (event) => {
        try {
            const parsed = JSON.parse(event.data as string) as WsEvent;
            useMessagesStore.getState().handleEvent(parsed);
        } catch (err) {
            console.warn('acp-devtools: invalid WS frame', err);
        }
    });

    ws.addEventListener('error', () => {
        // Suppress per-attempt errors while we are still in the reconnect loop —
        // they will surface as 'closed' only if we give up.
    });

    ws.addEventListener('close', () => {
        if (socket === ws) socket = null;
        if (manuallyClosed) {
            useMessagesStore.getState().setConnection('closed');
            return;
        }
        // Stay in `connecting` so the pill colour does not flap between
        // closed/connecting on every backoff cycle.
        const store2 = useMessagesStore.getState();
        if (openedOnce && store2.replayDone) {
            // Replay finished and the server hung up. Show idle, do not retry.
            store2.setConnection('idle');
            return;
        }
        store2.setConnection('connecting');
        scheduleReconnect();
    });
}

export function disconnect(): void {
    manuallyClosed = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket) {
        try {
            socket.close();
        } catch {
            // ignore
        }
        socket = null;
    }
    useMessagesStore.getState().setConnection('idle');
}

export function reconnect(): void {
    disconnect();
    manuallyClosed = false;
    attempt = 0;
    connect(currentUrl);
}
