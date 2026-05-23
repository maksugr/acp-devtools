import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapturedMessage, SessionRecord, WsEvent } from '@acp-devtools/core';
import {
    ALL_DIRECTIONS,
    ALL_KINDS,
    applyFilters,
    buildRequestIndex,
    selectMessage,
    useMessagesStore,
    type Filters,
} from './messagesStore';

const sessionFixture = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id: 1,
    name: null,
    agentCommand: 'mock',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    ...overrides,
});

let seqCounter = 0;
function mkMessage(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    seqCounter += 1;
    return {
        seq: seqCounter,
        timestamp: 1_700_000_000_000 + seqCounter,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'session/prompt',
        rpcId: seqCounter,
        raw: `{"jsonrpc":"2.0","id":${seqCounter},"method":"session/prompt"}`,
        payload: { jsonrpc: '2.0', id: seqCounter, method: 'session/prompt' },
        ...overrides,
    };
}

function chunk(sessionId: string, text: string, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return mkMessage({
        direction: 'agent-to-editor',
        kind: 'notification',
        method: 'session/update',
        rpcId: undefined,
        payload: {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
            },
        } as unknown as CapturedMessage['payload'],
        ...overrides,
    });
}

const initialFilters = (): Filters => ({
    directions: new Set(ALL_DIRECTIONS),
    kinds: new Set(ALL_KINDS),
    search: '',
    hideBoilerplate: false,
    showStreams: true,
});

function resetStore(): void {
    seqCounter = 0;
    useMessagesStore.setState({
        session: null,
        messages: [],
        connection: 'idle',
        lastError: null,
        selectedSeq: null,
        replayDone: false,
        filters: initialFilters(),
        playback: { cap: null, playing: false, speed: 1 },
        detailTab: 'tree',
        clearedUpToSeq: null,
    });
}

const send = (event: WsEvent) => useMessagesStore.getState().handleEvent(event);

beforeEach(resetStore);
afterEach(resetStore);

describe('handleEvent · session.start', () => {
    it('initialises fresh state on first session', () => {
        send({ type: 'session.start', session: sessionFixture({ id: 1 }) });
        const s = useMessagesStore.getState();
        expect(s.session?.id).toBe(1);
        expect(s.messages).toEqual([]);
        expect(s.replayDone).toBe(false);
    });

    it('preserves hydrated selectedSeq / clearedUpToSeq / playback on initial mount (state.session was null)', () => {
        // Pretend the URL hydrated these values before any session arrived.
        useMessagesStore.setState({
            selectedSeq: 42,
            clearedUpToSeq: 7,
            playback: { cap: 100, playing: false, speed: 2 },
        });
        send({ type: 'session.start', session: sessionFixture({ id: 5 }) });
        const s = useMessagesStore.getState();
        expect(s.selectedSeq).toBe(42);
        expect(s.clearedUpToSeq).toBe(7);
        expect(s.playback).toEqual({ cap: 100, playing: false, speed: 2 });
    });

    it('preserves user state on reconnect to the SAME session id', () => {
        send({ type: 'session.start', session: sessionFixture({ id: 5 }) });
        useMessagesStore.setState({
            selectedSeq: 9,
            clearedUpToSeq: 4,
            playback: { cap: 20, playing: false, speed: 1 },
        });
        // Reconnect — same session.id.
        send({ type: 'session.start', session: sessionFixture({ id: 5, startedAt: 999 }) });
        const s = useMessagesStore.getState();
        expect(s.selectedSeq).toBe(9);
        expect(s.clearedUpToSeq).toBe(4);
        expect(s.playback.cap).toBe(20);
    });

    it('RESETS selectedSeq / clearedUpToSeq / playback when switching to a DIFFERENT session', () => {
        send({ type: 'session.start', session: sessionFixture({ id: 5 }) });
        useMessagesStore.setState({
            selectedSeq: 9,
            clearedUpToSeq: 4,
            playback: { cap: 20, playing: true, speed: 4 },
        });
        send({ type: 'session.start', session: sessionFixture({ id: 6 }) });
        const s = useMessagesStore.getState();
        expect(s.selectedSeq).toBeNull();
        expect(s.clearedUpToSeq).toBeNull();
        expect(s.playback.cap).toBeNull();
        expect(s.playback.playing).toBe(false);
        // Speed is a user preference, kept across sessions.
        expect(s.playback.speed).toBe(4);
    });
});

describe('handleEvent · message and clear watermark', () => {
    it('appends messages on receipt', () => {
        send({ type: 'session.start', session: sessionFixture() });
        send({ type: 'message', message: mkMessage() });
        send({ type: 'message', message: mkMessage() });
        expect(useMessagesStore.getState().messages).toHaveLength(2);
    });

    it('drops replayed messages with seq <= clearedUpToSeq', () => {
        send({ type: 'session.start', session: sessionFixture() });
        send({ type: 'message', message: mkMessage() }); // seq 1
        send({ type: 'message', message: mkMessage() }); // seq 2
        useMessagesStore.getState().clear();
        const after = useMessagesStore.getState();
        expect(after.messages).toEqual([]);
        expect(after.clearedUpToSeq).toBe(2);

        // Reconnect → server replays seq 1..3
        send({ type: 'session.start', session: sessionFixture() });
        send({ type: 'message', message: mkMessage({ seq: 1 }) });
        send({ type: 'message', message: mkMessage({ seq: 2 }) });
        send({ type: 'message', message: mkMessage({ seq: 3 }) });
        const replayed = useMessagesStore.getState().messages.map((m) => m.seq);
        expect(replayed).toEqual([3]);
    });

    it('does NOT preserve clearedUpToSeq across a DIFFERENT session', () => {
        send({ type: 'session.start', session: sessionFixture({ id: 1 }) });
        send({ type: 'message', message: mkMessage() });
        useMessagesStore.getState().clear();
        send({ type: 'session.start', session: sessionFixture({ id: 2 }) });
        expect(useMessagesStore.getState().clearedUpToSeq).toBeNull();
    });
});

describe('handleEvent · replay.done and session.end', () => {
    it('flips replayDone to true', () => {
        send({ type: 'session.start', session: sessionFixture() });
        expect(useMessagesStore.getState().replayDone).toBe(false);
        send({ type: 'replay.done' });
        expect(useMessagesStore.getState().replayDone).toBe(true);
    });
    it('updates the session info on session.end', () => {
        send({ type: 'session.start', session: sessionFixture({ endedAt: null }) });
        send({ type: 'session.end', session: sessionFixture({ endedAt: 999 }) });
        expect(useMessagesStore.getState().session?.endedAt).toBe(999);
    });
});

describe('filter toggles', () => {
    it('toggles direction membership', () => {
        const { toggleDirection } = useMessagesStore.getState();
        toggleDirection('editor-to-agent');
        expect(useMessagesStore.getState().filters.directions.has('editor-to-agent')).toBe(false);
        toggleDirection('editor-to-agent');
        expect(useMessagesStore.getState().filters.directions.has('editor-to-agent')).toBe(true);
    });
    it('toggles kind membership', () => {
        useMessagesStore.getState().toggleKind('notification');
        expect(useMessagesStore.getState().filters.kinds.has('notification')).toBe(false);
    });
    it('toggleStreams flips showStreams', () => {
        expect(useMessagesStore.getState().filters.showStreams).toBe(true);
        useMessagesStore.getState().toggleStreams();
        expect(useMessagesStore.getState().filters.showStreams).toBe(false);
    });
});

describe('applyFilters', () => {
    function build(): CapturedMessage[] {
        seqCounter = 0;
        return [
            mkMessage({ method: 'initialize' }), // 1: out, request
            mkMessage({
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
            }), // 2: in, response
            mkMessage({
                direction: 'agent-to-editor',
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                payload: {
                    jsonrpc: '2.0',
                    method: 'session/update',
                    params: { update: { sessionUpdate: 'available_commands_update' } },
                } as unknown as CapturedMessage['payload'],
            }), // 3: in, notification (NOT a stream chunk)
            chunk('s', 'A'), // 4: stream chunk
            chunk('s', 'B'), // 5: stream chunk
            mkMessage({ method: 'session/set_mode' }), // 6: out, request (boilerplate)
        ];
    }

    it('passes everything by default', () => {
        const out = applyFilters(build(), initialFilters());
        expect(out).toHaveLength(6);
    });

    it('STREAM chip is INDEPENDENT of NOTIFICATION chip (today\'s bug)', () => {
        // notification off, but streams on — chunks should still appear.
        const filters = initialFilters();
        filters.kinds.delete('notification');
        const out = applyFilters(build(), filters);
        // Stream chunks (4,5) pass. Non-stream notification (3) does not.
        expect(out.map((m) => m.seq)).toEqual([1, 2, 4, 5, 6]);
    });

    it('STREAM off hides chunk notifications even when NOTIFICATION is on', () => {
        const filters = initialFilters();
        filters.showStreams = false;
        const out = applyFilters(build(), filters);
        // Chunks (4,5) gone, non-chunk notification (3) stays.
        expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 6]);
    });

    it('hideBoilerplate strips set_mode / set_model methods', () => {
        const filters = initialFilters();
        filters.hideBoilerplate = true;
        const out = applyFilters(build(), filters);
        expect(out.map((m) => m.seq)).not.toContain(6);
    });

    it('search filters by raw substring (case-insensitive)', () => {
        const filters = initialFilters();
        filters.search = 'INITIALIZE';
        const out = applyFilters(build(), filters);
        expect(out.every((m) => m.raw.toLowerCase().includes('initialize'))).toBe(true);
    });

    it('playbackCap hides messages with seq above the cap (today\'s bug)', () => {
        const out = applyFilters(build(), initialFilters(), 3);
        expect(out.map((m) => m.seq)).toEqual([1, 2, 3]);
    });

    it('direction filter narrows by side', () => {
        const filters = initialFilters();
        filters.directions = new Set(['editor-to-agent']);
        const out = applyFilters(build(), filters);
        expect(out.every((m) => m.direction === 'editor-to-agent')).toBe(true);
    });
});

describe('buildRequestIndex', () => {
    it('pairs each response/error with its earlier request via JSON-RPC id', () => {
        seqCounter = 0;
        const messages: CapturedMessage[] = [
            mkMessage({ method: 'a', rpcId: 1, kind: 'request' }),
            mkMessage({ method: 'b', rpcId: 2, kind: 'request' }),
            mkMessage({ rpcId: 1, kind: 'response', method: undefined }),
            mkMessage({ rpcId: 2, kind: 'error', method: undefined }),
        ];
        const idx = buildRequestIndex(messages);
        expect(idx.get(messages[2]!.seq)).toBe(messages[0]!.seq);
        expect(idx.get(messages[3]!.seq)).toBe(messages[1]!.seq);
    });

    it('ignores messages with no rpcId', () => {
        seqCounter = 0;
        const messages: CapturedMessage[] = [
            mkMessage({ method: 'notify', kind: 'notification', rpcId: undefined }),
        ];
        expect(buildRequestIndex(messages).size).toBe(0);
    });
});

describe('selectMessage', () => {
    it('finds by seq', () => {
        seqCounter = 0;
        const m1 = mkMessage();
        const m2 = mkMessage();
        expect(selectMessage([m1, m2], m2.seq)).toBe(m2);
    });
    it('returns null when not found', () => {
        expect(selectMessage([], 5)).toBeNull();
    });
});
