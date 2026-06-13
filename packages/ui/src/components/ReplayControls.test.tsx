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
        playback: { playhead: null, playing: false, speed: 1 },
    });
}

beforeEach(() => {
    useMessagesStore.setState({
        messages: [],
        playback: { playhead: null, playing: false, speed: 1 },
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

    it('renders the seq counter parked at the start "000 / max"', () => {
        seed([1, 2, 3]);
        render(<ReplayControls />);
        expect(screen.getByText('000 / 003')).toBeInTheDocument();
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
    it('shows Play and toggles playback when parked at the start', () => {
        seed([1, 2, 3]);
        // playhead = null (default) → parked at start → Play, not restart.
        render(<ReplayControls />);
        expect(useMessagesStore.getState().playback.playing).toBe(false);
        const playBtn = screen.getByTitle(/^play$/);
        fireEvent.click(playBtn);
        expect(useMessagesStore.getState().playback.playing).toBe(true);
    });

    it('clicking restart at end-of-stream rewinds the playhead to the start', () => {
        seed([1, 2, 3]);
        // playhead at the last seq → atEnd → Replay button.
        act(() => useMessagesStore.setState({ playback: { playhead: 3, playing: false, speed: 1 } }));
        render(<ReplayControls />);
        const restartBtn = screen.getByTitle(/^restart playback$/);
        fireEvent.click(restartBtn);
        const state = useMessagesStore.getState();
        expect(state.playback.playhead).toBeNull();
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
    it('changing the slider moves the playhead and pauses playback', () => {
        seed([1, 2, 3, 4, 5]);
        // Start playing first
        act(() => useMessagesStore.setState({ playback: { playhead: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '3' } });
        const state = useMessagesStore.getState();
        expect(state.playback.playhead).toBe(3);
        expect(state.playback.playing).toBe(false);
    });

    it('scrubbing to the max value parks the playhead at the end', () => {
        seed([1, 2, 3]);
        act(() => useMessagesStore.setState({ playback: { playhead: 1, playing: false, speed: 1 } }));
        render(<ReplayControls />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '3' } }); // 3 = maxSeq
        expect(useMessagesStore.getState().playback.playhead).toBe(3);
        // At the end → the button offers a restart.
        expect(screen.getByTitle(/^restart playback$/)).toBeInTheDocument();
    });
});

describe('ReplayControls — auto-advance ticker', () => {
    it('advances the playhead to the next seq when playing', async () => {
        vi.useFakeTimers();
        seed([1, 2, 3]);
        act(() => useMessagesStore.setState({ playback: { playhead: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        // Per the ticker formula: delta = ts(seq2)-ts(seq1) = 200ms / speed=1 → 200ms
        await act(async () => {
            await vi.advanceTimersByTimeAsync(250);
        });
        expect(useMessagesStore.getState().playback.playhead).toBe(2);
    });

    it('stops auto-playing when the end is reached', async () => {
        vi.useFakeTimers();
        seed([1, 2]);
        act(() => useMessagesStore.setState({ playback: { playhead: 1, playing: true, speed: 1 } }));
        render(<ReplayControls />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        // cap moved to 2 (last)
        expect(useMessagesStore.getState().playback.playhead).toBe(2);
        // After advancing, the effect re-runs and detects atEnd → stops playing
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(useMessagesStore.getState().playback.playing).toBe(false);
    });
});
