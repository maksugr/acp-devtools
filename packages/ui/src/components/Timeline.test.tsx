import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';

// Shared recorder so tests can inspect the props Timeline hands Virtuoso and
// whether it programmatically scrolled. `vi.hoisted` keeps it reachable from
// the hoisted `vi.mock` factory below.
const virtuosoState = vi.hoisted(() => ({
    scrollToIndex: vi.fn(),
    lastProps: {} as Record<string, unknown>,
}));

// react-virtuoso virtualizes off-screen rows away in jsdom (zero height →
// nothing renders). Replace it with a plain list that renders every item so
// we can assert on the rows Timeline produces.
vi.mock('react-virtuoso', async () => {
    const React = await import('react');
    return {
        Virtuoso: React.forwardRef(
            (
                props: { totalCount: number; itemContent: (i: number) => React.ReactNode },
                ref: React.Ref<unknown>,
            ) => {
                virtuosoState.lastProps = props as Record<string, unknown>;
                React.useImperativeHandle(ref, () => ({
                    scrollToIndex: virtuosoState.scrollToIndex,
                }));
                return React.createElement(
                    'div',
                    { 'data-testid': 'virtuoso' },
                    Array.from({ length: props.totalCount }, (_, i) =>
                        React.createElement('div', { key: i }, props.itemContent(i)),
                    ),
                );
            },
        ),
    };
});

import { Timeline } from './Timeline';
import { ALL_DIRECTIONS, ALL_KINDS, useMessagesStore } from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';

function mk(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{}',
        payload: null,
        ...overrides,
    };
}

function setMessages(messages: CapturedMessage[], kinds = new Set(ALL_KINDS)) {
    useMessagesStore.setState({
        messages,
        selectedSeq: null,
        replayDone: false,
        playback: { playhead: null, playing: false, speed: 1 },
        filters: {
            directions: new Set(ALL_DIRECTIONS),
            kinds,
            search: '',
            showStreams: true,
        },
    });
}

beforeEach(() => {
    setMessages([]);
    useMessagesStore.setState({ session: null });
    useDiscoveryStore.setState({ selectedUrl: null });
    virtuosoState.scrollToIndex.mockClear();
    virtuosoState.lastProps = {};
});

describe('Timeline', () => {
    it('renders a row per filtered message', () => {
        setMessages([
            mk(1, { method: 'initialize' }),
            mk(2, {
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                direction: 'agent-to-editor',
            }),
        ]);
        render(<Timeline />);
        expect(screen.getByText('initialize')).toBeInTheDocument();
        expect(screen.getByText('session/update')).toBeInTheDocument();
    });

    it('shows the empty state when nothing matches the filters', () => {
        render(<Timeline />);
        expect(screen.getByText('no messages match current filters')).toBeInTheDocument();
    });

    it('reports how many messages are hidden by filters', () => {
        setMessages(
            [
                mk(1, { kind: 'request', method: 'initialize' }),
                mk(2, {
                    kind: 'notification',
                    method: 'session/update',
                    rpcId: undefined,
                    direction: 'agent-to-editor',
                }),
                mk(3, {
                    kind: 'response',
                    method: undefined,
                    rpcId: 1,
                    direction: 'agent-to-editor',
                }),
            ],
            new Set(['request']),
        );
        render(<Timeline />);
        expect(screen.getByText('initialize')).toBeInTheDocument();
        expect(screen.queryByText('session/update')).not.toBeInTheDocument();
        expect(screen.getByText(/showing 1 of 3/)).toBeInTheDocument();
    });
});

describe('Timeline auto-scroll', () => {
    const LIVE_URL = 'ws://127.0.0.1:54321';
    const REPLAY_URL = 'ws://127.0.0.1:3737/replay/7';

    function backlog() {
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({
            replayDone: true,
            session: { id: 1 } as never,
        });
    }

    it('pins a live capture to the bottom once the backlog finishes', () => {
        vi.useFakeTimers();
        try {
            useDiscoveryStore.setState({ selectedUrl: LIVE_URL });
            backlog();
            render(<Timeline />);
            vi.runAllTimers();
            expect(virtuosoState.scrollToIndex).toHaveBeenCalledWith(
                expect.objectContaining({ index: 2, align: 'end' }),
            );
            expect(virtuosoState.lastProps.initialTopMostItemIndex).toBe(2);
            expect(typeof virtuosoState.lastProps.followOutput).toBe('function');
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a replayed session at the top (no scroll-to-bottom)', () => {
        vi.useFakeTimers();
        try {
            useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
            backlog();
            render(<Timeline />);
            vi.runAllTimers();
            expect(virtuosoState.scrollToIndex).not.toHaveBeenCalled();
            expect(virtuosoState.lastProps.initialTopMostItemIndex).toBeUndefined();
            expect(virtuosoState.lastProps.followOutput).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves an imported session at the top (selectedUrl is null)', () => {
        vi.useFakeTimers();
        try {
            useDiscoveryStore.setState({ selectedUrl: null });
            backlog();
            render(<Timeline />);
            vi.runAllTimers();
            expect(virtuosoState.scrollToIndex).not.toHaveBeenCalled();
            expect(virtuosoState.lastProps.initialTopMostItemIndex).toBeUndefined();
            expect(virtuosoState.lastProps.followOutput).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Timeline restore on reload', () => {
    const REPLAY_URL = 'ws://127.0.0.1:3737/replay/7';

    function recorded(playhead: number | null, selectedSeq: number | null) {
        useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({
            replayDone: true,
            session: { id: 1 } as never,
            selectedSeq,
            playback: { playhead, playing: false, speed: 1 },
        });
    }

    it('resets a finished playhead and stays at the top (nothing left to watch)', () => {
        vi.useFakeTimers();
        try {
            recorded(3, null); // 3 = last seq → fully played before reload
            render(<Timeline />);
            vi.runAllTimers();
            expect(useMessagesStore.getState().playback.playhead).toBeNull();
            expect(virtuosoState.scrollToIndex).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('smooth-scrolls to the selected seq, which wins over the playhead', () => {
        vi.useFakeTimers();
        try {
            recorded(2, 1); // playhead at #2, but seq=#1 is selected
            render(<Timeline />);
            vi.runAllTimers();
            expect(virtuosoState.scrollToIndex).toHaveBeenCalledWith(
                expect.objectContaining({ index: 0, align: 'center', behavior: 'smooth' }),
            );
            // playhead is mid-session, not finished → left intact
            expect(useMessagesStore.getState().playback.playhead).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('smooth-scrolls to a mid-session playhead when no seq is selected', () => {
        vi.useFakeTimers();
        try {
            recorded(2, null);
            render(<Timeline />);
            vi.runAllTimers();
            expect(virtuosoState.scrollToIndex).toHaveBeenCalledWith(
                expect.objectContaining({ index: 1, align: 'center', behavior: 'smooth' }),
            );
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Timeline playback follow', () => {
    const REPLAY_URL = 'ws://127.0.0.1:3737/replay/7';

    it('scrolls to keep the playhead centred while playing', () => {
        useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({ playback: { playhead: 3, playing: true, speed: 1 } });
        render(<Timeline />);
        expect(virtuosoState.scrollToIndex).toHaveBeenCalledWith(
            expect.objectContaining({ index: 2, align: 'center' }),
        );
    });

    it('does not auto-scroll while paused', () => {
        useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({ playback: { playhead: 3, playing: false, speed: 1 } });
        render(<Timeline />);
        expect(virtuosoState.scrollToIndex).not.toHaveBeenCalled();
    });

    it('stops following after the user wheels mid-playback', () => {
        useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({ playback: { playhead: 1, playing: true, speed: 1 } });
        render(<Timeline />);
        // initial follow fired once
        expect(virtuosoState.scrollToIndex).toHaveBeenCalled();
        virtuosoState.scrollToIndex.mockClear();
        // user takes over the scroll
        fireEvent.wheel(screen.getByTestId('virtuoso'));
        // playhead advances, but follow must stay off until the next play press
        act(() => {
            useMessagesStore.setState({ playback: { playhead: 3, playing: true, speed: 1 } });
        });
        expect(virtuosoState.scrollToIndex).not.toHaveBeenCalled();
    });
});

describe('Timeline playhead rail', () => {
    const REPLAY_URL = 'ws://127.0.0.1:3737/replay/7';
    const LIVE_URL = 'ws://127.0.0.1:54321';

    it('renders the playhead knob for a recorded session at the current frame', () => {
        useDiscoveryStore.setState({ selectedUrl: REPLAY_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({ playback: { playhead: 2, playing: false, speed: 1 } });
        const { container } = render(<Timeline />);
        expect(container.querySelector('.rounded-full')).not.toBeNull();
    });

    it('shows no rail for a live capture', () => {
        useDiscoveryStore.setState({ selectedUrl: LIVE_URL });
        setMessages([mk(1), mk(2), mk(3)]);
        useMessagesStore.setState({ playback: { playhead: 2, playing: false, speed: 1 } });
        const { container } = render(<Timeline />);
        expect(container.querySelector('.rounded-full')).toBeNull();
    });
});
