import type { CapturedMessage, WsEvent } from '@acp-devtools/core';
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

// rAF-batching buffer for incoming `message` events. Replays of fat
// sessions can push 1000+ frames in a single WS burst; if each one called
// `set()` independently every subscriber (perf insights, timeline, virtuoso
// scroll) would re-run its expensive selector once per frame and the main
// thread would lock up. Instead we accumulate frames and flush them in a
// single store update per animation frame.
let pendingMessages: CapturedMessage[] = [];
let flushScheduled = false;

function flushPendingMessages(): void {
    flushScheduled = false;
    if (pendingMessages.length === 0) return;
    const batch = pendingMessages;
    pendingMessages = [];
    useMessagesStore.getState().appendMessages(batch);
}

function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(flushPendingMessages);
    } else {
        // jsdom / non-browser fallback: fire as a microtask so unit tests
        // still see the appended messages synchronously after a tick.
        Promise.resolve().then(flushPendingMessages);
    }
}

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
    // Drop any messages buffered from the previous capture — they belong to
    // the old session and would otherwise leak into the new one's store.
    pendingMessages = [];
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
            if (parsed.type === 'message') {
                // Queue and flush in batches — see comment above.
                pendingMessages.push(parsed.message);
                scheduleFlush();
                return;
            }
            // Non-message events (session.start, replay.done, session.end)
            // must observe the messages already received, so flush the
            // pending buffer synchronously before dispatching.
            if (pendingMessages.length > 0) flushPendingMessages();
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
