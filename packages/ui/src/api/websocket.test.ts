import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// websocket.ts holds module-level state (socket, attempt, manuallyClosed, …)
// — every test starts with a fresh import to avoid bleed-through between cases.
import type * as WsModule from './websocket';
import type * as StoreModule from '../store/messagesStore';

let wsModule: typeof WsModule;
let storeModule: typeof StoreModule;
let lastSocket: FakeWebSocket | null = null;

interface FakeWebSocket {
    url: string;
    readyState: number;
    listeners: Record<string, Array<(ev: { data?: string }) => void>>;
    addEventListener(type: string, fn: (ev: { data?: string }) => void): void;
    removeEventListener?(type: string, fn: (ev: { data?: string }) => void): void;
    close(): void;
    fire(type: 'open' | 'message' | 'close' | 'error', data?: string): void;
}

function makeFakeWebSocketCtor(): typeof WebSocket {
    return function FakeWebSocketCtor(url: string) {
        const fake: FakeWebSocket = {
            url,
            readyState: 0, // CONNECTING
            listeners: {},
            addEventListener(type, fn) {
                this.listeners[type] = this.listeners[type] ?? [];
                this.listeners[type]!.push(fn);
            },
            close() {
                this.readyState = 3; // CLOSED
                this.fire('close');
            },
            fire(type, data) {
                const subs = this.listeners[type] ?? [];
                for (const s of subs) s({ data });
            },
        };
        lastSocket = fake;
        return fake as unknown as WebSocket;
    } as unknown as typeof WebSocket;
}

beforeEach(async () => {
    vi.useFakeTimers();
    lastSocket = null;
    vi.stubGlobal('WebSocket', makeFakeWebSocketCtor());
    vi.resetModules();
    wsModule = await import('./websocket');
    storeModule = await import('../store/messagesStore');
    storeModule.useMessagesStore.setState({
        connection: 'idle',
        lastError: null,
        replayDone: false,
    });
});

afterEach(() => {
    wsModule.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('connect / events', () => {
    it('sets connection=connecting and constructs a WebSocket', () => {
        wsModule.connect('ws://127.0.0.1:9999');
        expect(lastSocket).not.toBeNull();
        expect(lastSocket!.url).toBe('ws://127.0.0.1:9999');
        expect(storeModule.useMessagesStore.getState().connection).toBe('connecting');
    });

    it('transitions to "open" on the WebSocket open event', () => {
        wsModule.connect('ws://127.0.0.1:9999');
        lastSocket!.fire('open');
        expect(storeModule.useMessagesStore.getState().connection).toBe('open');
    });

    it('parses incoming JSON frames and routes them to the store', () => {
        wsModule.connect('ws://127.0.0.1:9999');
        lastSocket!.fire('open');
        lastSocket!.fire(
            'message',
            JSON.stringify({
                type: 'session.start',
                session: {
                    id: 1,
                    name: null,
                    agentCommand: 'mock',
                    startedAt: 0,
                    endedAt: null,
                    clientName: null,
                    importedAt: null,
                    clientVersion: null,
                    clientPlatform: null,
                    agentName: null,
                    agentVersion: null,
                    protocolVersion: null,
                    currentMode: null,
                    currentModel: null,
                    agentCapabilitiesJson: null,
                },
            }),
        );
        const s = storeModule.useMessagesStore.getState();
        expect(s.session?.id).toBe(1);
    });

    it('ignores malformed JSON frames without crashing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        wsModule.connect('ws://127.0.0.1:9999');
        lastSocket!.fire('open');
        lastSocket!.fire('message', 'not-json');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('reconnect / backoff', () => {
    it('schedules a reconnect after the socket closes', async () => {
        wsModule.connect('ws://127.0.0.1:9999');
        lastSocket!.fire('open'); // bumps attempt back to 0
        const first = lastSocket;
        lastSocket!.fire('close');
        // First retry uses base delay (~1500ms)
        await vi.advanceTimersByTimeAsync(1600);
        expect(lastSocket).not.toBe(first); // new socket created
        expect(storeModule.useMessagesStore.getState().connection).toBe('connecting');
    });

    it('backs off exponentially on repeated failures', async () => {
        wsModule.connect('ws://127.0.0.1:9999');
        // First attempt — close immediately. Retry scheduled at base delay
        // (~1500ms) because attempt starts at 0.
        lastSocket!.fire('close');
        const after0 = lastSocket;
        await vi.advanceTimersByTimeAsync(1600);
        expect(lastSocket).not.toBe(after0);

        // Second attempt — close again. Delay is now 1500 * 1.6 = 2400ms.
        const after1 = lastSocket;
        lastSocket!.fire('close');
        await vi.advanceTimersByTimeAsync(1500);
        expect(lastSocket).toBe(after1); // not enough time elapsed yet
        await vi.advanceTimersByTimeAsync(2000);
        expect(lastSocket).not.toBe(after1);
    });
});

describe('disconnect', () => {
    it('cancels pending reconnect and sets connection=idle', async () => {
        wsModule.connect('ws://127.0.0.1:9999');
        lastSocket!.fire('close');
        const beforeDisconnect = lastSocket;
        wsModule.disconnect();
        expect(storeModule.useMessagesStore.getState().connection).toBe('idle');
        // No new sockets should be created after disconnect
        await vi.advanceTimersByTimeAsync(20_000);
        expect(lastSocket).toBe(beforeDisconnect);
    });
});

describe('reconnect()', () => {
    it('resets attempt and forces a fresh connection', () => {
        wsModule.connect('ws://127.0.0.1:9999');
        const first = lastSocket;
        wsModule.reconnect();
        expect(lastSocket).not.toBe(first);
        expect(lastSocket!.url).toBe('ws://127.0.0.1:9999');
    });
});
