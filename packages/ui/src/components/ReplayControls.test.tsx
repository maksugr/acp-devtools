import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';
import { ReplayControls } from './ReplayControls';
import { useMessagesStore } from '../store/messagesStore';

function msg(seq: number, timestamp = 1_700_000_000_000 + seq * 100): CapturedMessage {
    return {
        seq,
        timestamp,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{}',
        payload: { jsonrpc: '2.0', id: seq, method: 'initialize' },
    } as CapturedMessage;
}

function seed(seqs: number[]) {
    useMessagesStore.setState({
        messages: seqs.map((s) => msg(s, 1_700_000_000_000 + s * 200)),
        playback: { cap: null, playing: false, speed: 1 },
    });
}

beforeEach(() => {
    useMessagesStore.setState({
        messages: [],
        playback: { cap: null, playing: false, speed: 1 },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ReplayControls — rendering', () => {
    it('renders nothing when there are no messages', () => {
        const { container } = render(<ReplayControls />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the seq counter "current / max"', () => {
        seed([1, 2, 3]);
        render(<ReplayControls />);
        expect(screen.getByText('003 / 003')).toBeInTheDocument();
    });

    it('renders all speed buttons', () => {
        seed([1, 2, 3]);
        render(<ReplayControls />);
        for (const s of ['0.5×', '1×', '2×', '4×', '8×']) {
            expect(screen.getByRole('button', { name: new RegExp(`^${s}$`) })).toBeInTheDocument();
        }
    });
});

describe('ReplayControls — play / pause', () => {
    it('the play button toggles playback state', () => {
        seed([1, 2, 3]);
        // Cap at first seq so we're not at the end (otherwise togglePlay restarts)
        act(() => useMessagesStore.setState({ playback: { cap: 1, playing: false, speed: 1 } }));
        render(<ReplayControls />);
        // Initially paused
        expect(useMessagesStore.getState().playback.playing).toBe(false);
        // Find the play/pause button by its accessible title
        const playBtn = screen.getByTitle(/^play$/);
        fireEvent.click(playBtn);
        expect(useMessagesStore.getState().playback.playing).toBe(true);
    });

    it('clicking play at end-of-stream restarts from the first seq', () => {
        seed([1, 2, 3]);
        // playback.cap = null means "show all" → atEnd = true
        render(<ReplayControls />);
        const restartBtn = screen.getByTitle(/^restart playback$/);
        fireEvent.click(restartBtn);
        const state = useMessagesStore.getState();
        expect(state.playback.cap).toBe(1);
        expect(state.playback.playing).toBe(true);
    });
});

describe('ReplayControls — speed selection', () => {
    it('clicking a speed button updates playback.speed', () => {
        seed([1, 2, 3]);
        render(<ReplayControls />);
        fireEvent.click(screen.getByRole('button', { name: '4×' }));
        expect(useMessagesStore.getState().playback.speed).toBe(4);
    });
});

describe('ReplayControls — manual scrub', () => {
    it('changing the slider sets cap and pauses playback', () => {
        seed([1, 2, 3, 4, 5]);
        // Start playing first
        act(() => useMessagesStore.setState({ playback: { cap: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '3' } });
        const state = useMessagesStore.getState();
        expect(state.playback.cap).toBe(3);
        expect(state.playback.playing).toBe(false);
    });

    it('scrubbing to the max value clears the cap (null = show all)', () => {
        seed([1, 2, 3]);
        act(() => useMessagesStore.setState({ playback: { cap: 1, playing: false, speed: 1 } }));
        render(<ReplayControls />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '3' } }); // 3 = maxSeq
        expect(useMessagesStore.getState().playback.cap).toBeNull();
    });
});

describe('ReplayControls — "show all" button', () => {
    it('clears cap and stops playback', () => {
        seed([1, 2, 3]);
        act(() =>
            useMessagesStore.setState({ playback: { cap: 2, playing: true, speed: 1 } }),
        );
        render(<ReplayControls />);
        fireEvent.click(screen.getByRole('button', { name: /show all/i }));
        const state = useMessagesStore.getState();
        expect(state.playback.cap).toBeNull();
        expect(state.playback.playing).toBe(false);
    });
});

describe('ReplayControls — auto-advance ticker', () => {
    it('advances cap to the next seq when playing', async () => {
        vi.useFakeTimers();
        seed([1, 2, 3]);
        act(() => useMessagesStore.setState({ playback: { cap: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        // Per the ticker formula: delta = ts(seq2)-ts(seq1) = 200ms / speed=1 → 200ms
        await act(async () => {
            await vi.advanceTimersByTimeAsync(250);
        });
        expect(useMessagesStore.getState().playback.cap).toBe(2);
    });

    it('stops auto-playing when the end is reached', async () => {
        vi.useFakeTimers();
        seed([1, 2]);
        act(() => useMessagesStore.setState({ playback: { cap: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        // cap moved to 2 (last)
        expect(useMessagesStore.getState().playback.cap).toBe(2);
        // After advancing, the effect re-runs and detects atEnd → stops playing
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(useMessagesStore.getState().playback.playing).toBe(false);
    });
});
