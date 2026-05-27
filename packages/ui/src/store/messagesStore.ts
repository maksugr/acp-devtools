import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CapturedMessage, SessionRecord, WsEvent } from '@acp-devtools/core';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
export type DetailTab = 'tree' | 'raw' | 'meta' | 'spec';

export interface Filters {
    directions: Set<CapturedMessage['direction']>;
    kinds: Set<CapturedMessage['kind']>;
    search: string;
    showStreams: boolean;
}

export interface Playback {
    /** When non-null, messages with seq > value are hidden from view. */
    cap: number | null;
    /** Auto-advance is running. */
    playing: boolean;
    /** Playback speed multiplier (1 = real-time by timestamp). */
    speed: number;
}

interface MessagesState {
    session: SessionRecord | null;
    messages: CapturedMessage[];
    connection: ConnectionStatus;
    lastError: string | null;
    selectedSeq: number | null;
    replayDone: boolean;
    filters: Filters;
    playback: Playback;
    detailTab: DetailTab;
    /**
     * Highest seq the user wanted to "clear past". Subsequent replay events
     * with seq <= this are dropped, so reconnect/backlog re-delivery does not
     * undo a Clear action. Reset when a new session.id arrives.
     */
    clearedUpToSeq: number | null;

    handleEvent: (event: WsEvent) => void;
    /**
     * Append multiple messages in a single `set()` call so subscribers only
     * fire once per batch — the WS layer accumulates incoming `message`
     * events and flushes them on requestAnimationFrame, turning O(N)
     * re-renders per WS burst into ~one per frame. Messages already
     * suppressed by `clearedUpToSeq` are dropped.
     */
    appendMessages: (msgs: CapturedMessage[]) => void;
    setConnection: (status: ConnectionStatus, error?: string | null) => void;
    select: (seq: number | null) => void;
    setSearch: (q: string) => void;
    toggleDirection: (dir: CapturedMessage['direction']) => void;
    toggleKind: (kind: CapturedMessage['kind']) => void;
    toggleStreams: () => void;
    setPlaybackCap: (cap: number | null) => void;
    setPlaying: (playing: boolean) => void;
    setPlaybackSpeed: (speed: number) => void;
    setDetailTab: (tab: DetailTab) => void;
    clear: () => void;
}

const ALL_DIRECTIONS: CapturedMessage['direction'][] = ['editor-to-agent', 'agent-to-editor'];
const ALL_KINDS: CapturedMessage['kind'][] = [
    'request',
    'response',
    'notification',
    'error',
    'unknown',
];

const initialFilters: Filters = {
    directions: new Set(ALL_DIRECTIONS),
    kinds: new Set(ALL_KINDS),
    search: '',
    showStreams: true,
};

function isStreamChunk(m: CapturedMessage): boolean {
    if (m.kind !== 'notification' || m.method !== 'session/update') return false;
    const params = (m.payload as { params?: { update?: { sessionUpdate?: string } } } | null)
        ?.params;
    return params?.update?.sessionUpdate === 'agent_message_chunk';
}

interface PersistedFilters {
    directions: CapturedMessage['direction'][];
    kinds: CapturedMessage['kind'][];
    showStreams: boolean;
}

export const useMessagesStore = create<MessagesState>()(
    persist<MessagesState, [], [], { filters: PersistedFilters }>(
        (set) => ({
    session: null,
    messages: [],
    connection: 'idle',
    lastError: null,
    selectedSeq: null,
    replayDone: false,
    filters: initialFilters,
    playback: { cap: null, playing: false, speed: 1 },
    detailTab: 'tree',
    clearedUpToSeq: null,

    handleEvent: (event) => {
        switch (event.type) {
            case 'session.start':
                set((state) => {
                    const sameSession =
                        state.session !== null && state.session.id === event.session.id;
                    // Fresh mount: state.session is still null but selectedSeq /
                    // clearedUpToSeq / playback may have been hydrated from the
                    // URL. Treat the very first session.start as part of that
                    // hydration so we do NOT stomp on a shareable link.
                    const isInitial = state.session === null;
                    const keepUserState = sameSession || isInitial;
                    return {
                        session: event.session,
                        messages: [],
                        selectedSeq: keepUserState ? state.selectedSeq : null,
                        replayDone: false,
                        clearedUpToSeq: keepUserState ? state.clearedUpToSeq : null,
                        playback: keepUserState
                            ? state.playback
                            : { ...state.playback, cap: null, playing: false },
                    };
                });
                return;
            case 'message':
                set((state) => {
                    if (
                        state.clearedUpToSeq !== null &&
                        event.message.seq <= state.clearedUpToSeq
                    ) {
                        return {};
                    }
                    return { messages: [...state.messages, event.message] };
                });
                return;
            case 'replay.done':
                set({ replayDone: true });
                return;
            case 'session.end':
                set({ session: event.session });
                return;
        }
    },

    setConnection: (status, error = null) => set({ connection: status, lastError: error }),
    select: (seq) => set({ selectedSeq: seq }),
    setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
    toggleDirection: (dir) =>
        set((s) => {
            const next = new Set(s.filters.directions);
            if (next.has(dir)) next.delete(dir);
            else next.add(dir);
            return { filters: { ...s.filters, directions: next } };
        }),
    toggleKind: (kind) =>
        set((s) => {
            const next = new Set(s.filters.kinds);
            if (next.has(kind)) next.delete(kind);
            else next.add(kind);
            return { filters: { ...s.filters, kinds: next } };
        }),
    toggleStreams: () =>
        set((s) => ({ filters: { ...s.filters, showStreams: !s.filters.showStreams } })),
    setPlaybackCap: (cap) =>
        set((s) => ({ playback: { ...s.playback, cap } })),
    setPlaying: (playing) =>
        set((s) => ({ playback: { ...s.playback, playing } })),
    setPlaybackSpeed: (speed) =>
        set((s) => ({ playback: { ...s.playback, speed } })),
    setDetailTab: (tab) => set({ detailTab: tab }),
    appendMessages: (msgs) => {
        if (msgs.length === 0) return;
        set((state) => {
            const filtered =
                state.clearedUpToSeq !== null
                    ? msgs.filter((m) => m.seq > state.clearedUpToSeq!)
                    : msgs;
            if (filtered.length === 0) return state;
            return { messages: [...state.messages, ...filtered] };
        });
    },
    clear: () =>
        set((state) => {
            const lastSeq =
                state.messages.length > 0
                    ? state.messages[state.messages.length - 1]!.seq
                    : state.clearedUpToSeq;
            return {
                messages: [],
                selectedSeq: null,
                clearedUpToSeq: lastSeq,
            };
        }),
    }),
        {
            name: 'acp.messages.v1',
            partialize: (state) => ({
                filters: {
                    directions: [...state.filters.directions],
                    kinds: [...state.filters.kinds],
                    showStreams: state.filters.showStreams,
                },
            }),
            merge: (persistedRaw, current) => {
                const persisted = persistedRaw as { filters?: PersistedFilters } | undefined;
                if (!persisted?.filters) return current;
                return {
                    ...current,
                    filters: {
                        ...current.filters,
                        directions: new Set(persisted.filters.directions),
                        kinds: new Set(persisted.filters.kinds),
                        showStreams: persisted.filters.showStreams,
                    },
                };
            },
        },
    ),
);

export function applyFilters(
    messages: CapturedMessage[],
    filters: Filters,
    playbackCap: number | null = null,
): CapturedMessage[] {
    const q = filters.search.trim().toLowerCase();
    return messages.filter((m) => {
        if (playbackCap !== null && m.seq > playbackCap) return false;
        if (!filters.directions.has(m.direction)) return false;

        // STREAM chip is an independent gate for `agent_message_chunk` runs
        // (they ARE notifications under the hood, but they have their own UX
        // and shouldn't disappear just because the user dimmed the
        // "notification" chip — that chip targets non-stream notifications
        // like tool_call/plan/availability updates).
        const stream = isStreamChunk(m);
        if (stream) {
            if (!filters.showStreams) return false;
        } else if (!filters.kinds.has(m.kind)) {
            return false;
        }

        if (q && !m.raw.toLowerCase().includes(q)) return false;
        return true;
    });
}

export function selectMessage(messages: CapturedMessage[], seq: number | null): CapturedMessage | null {
    if (seq === null) return null;
    return messages.find((m) => m.seq === seq) ?? null;
}

/** Map each response seq → request seq via JSON-RPC id, for latency annotations. */
export function buildRequestIndex(messages: CapturedMessage[]): Map<number, number> {
    const idToRequestSeq = new Map<string, number>();
    const responseToRequest = new Map<number, number>();
    for (const m of messages) {
        if (m.rpcId === undefined || m.rpcId === null) continue;
        const key = String(m.rpcId);
        if (m.kind === 'request') {
            idToRequestSeq.set(key, m.seq);
        } else if (m.kind === 'response' || m.kind === 'error') {
            const reqSeq = idToRequestSeq.get(key);
            if (reqSeq !== undefined) responseToRequest.set(m.seq, reqSeq);
        }
    }
    return responseToRequest;
}

export { ALL_DIRECTIONS, ALL_KINDS };
