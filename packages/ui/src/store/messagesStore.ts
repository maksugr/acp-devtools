import { create } from 'zustand';
import type { CapturedMessage, SessionRecord, WsEvent } from '@acp-devtools/core';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface Filters {
    directions: Set<CapturedMessage['direction']>;
    kinds: Set<CapturedMessage['kind']>;
    search: string;
    hideBoilerplate: boolean;
    showStreams: boolean;
}

interface MessagesState {
    session: SessionRecord | null;
    messages: CapturedMessage[];
    connection: ConnectionStatus;
    lastError: string | null;
    selectedSeq: number | null;
    replayDone: boolean;
    filters: Filters;
    /**
     * Highest seq the user wanted to "clear past". Subsequent replay events
     * with seq <= this are dropped, so reconnect/backlog re-delivery does not
     * undo a Clear action. Reset when a new session.id arrives.
     */
    clearedUpToSeq: number | null;

    handleEvent: (event: WsEvent) => void;
    setConnection: (status: ConnectionStatus, error?: string | null) => void;
    select: (seq: number | null) => void;
    setSearch: (q: string) => void;
    toggleDirection: (dir: CapturedMessage['direction']) => void;
    toggleKind: (kind: CapturedMessage['kind']) => void;
    toggleStreams: () => void;
    setHideBoilerplate: (v: boolean) => void;
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

const BOILERPLATE_METHODS = new Set(['session/set_mode', 'session/set_model']);

const initialFilters: Filters = {
    directions: new Set(ALL_DIRECTIONS),
    kinds: new Set(ALL_KINDS),
    search: '',
    hideBoilerplate: false,
    showStreams: true,
};

function isStreamChunk(m: CapturedMessage): boolean {
    if (m.kind !== 'notification' || m.method !== 'session/update') return false;
    const params = (m.payload as { params?: { update?: { sessionUpdate?: string } } } | null)
        ?.params;
    return params?.update?.sessionUpdate === 'agent_message_chunk';
}

export const useMessagesStore = create<MessagesState>((set) => ({
    session: null,
    messages: [],
    connection: 'idle',
    lastError: null,
    selectedSeq: null,
    replayDone: false,
    filters: initialFilters,
    clearedUpToSeq: null,

    handleEvent: (event) => {
        switch (event.type) {
            case 'session.start':
                set((state) => {
                    const sameSession =
                        state.session !== null && state.session.id === event.session.id;
                    return {
                        session: event.session,
                        messages: [],
                        selectedSeq: null,
                        replayDone: false,
                        // Preserve the clear watermark for reconnects to the SAME session
                        // so backlog replay does not resurrect cleared messages.
                        clearedUpToSeq: sameSession ? state.clearedUpToSeq : null,
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
    setHideBoilerplate: (v) => set((s) => ({ filters: { ...s.filters, hideBoilerplate: v } })),
    clear: () =>
        set((state) => {
            const lastSeq = state.messages.length > 0
                ? state.messages[state.messages.length - 1]!.seq
                : state.clearedUpToSeq;
            return {
                messages: [],
                selectedSeq: null,
                clearedUpToSeq: lastSeq,
            };
        }),
}));

export function applyFilters(messages: CapturedMessage[], filters: Filters): CapturedMessage[] {
    const q = filters.search.trim().toLowerCase();
    return messages.filter((m) => {
        if (!filters.directions.has(m.direction)) return false;
        if (!filters.kinds.has(m.kind)) return false;
        if (filters.hideBoilerplate && m.method && BOILERPLATE_METHODS.has(m.method)) return false;
        if (!filters.showStreams && isStreamChunk(m)) return false;
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

export { ALL_DIRECTIONS, ALL_KINDS, BOILERPLATE_METHODS };
