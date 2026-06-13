import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaygroundEntry } from './PlaygroundEntry';
import { useMessagesStore } from '../store/messagesStore';

const validExport = {
    version: 1,
    exportedAt: 1_700_000_000_000,
    tool: { name: 'acp-devtools', version: '0.1.0' },
    session: {
        id: 42,
        name: 'imported-test',
        agentCommand: 'mock',
        clientName: 'Zed',
        startedAt: 1_700_000_000_000,
        endedAt: null,
    },
    messages: [],
};

function resetStore(): void {
    useMessagesStore.setState({
        session: null,
        messages: [],
        connection: 'idle',
        lastError: null,
        selectedSeq: null,
        replayDone: false,
        playback: { playhead: null, playing: false, speed: 1 },
        clearedUpToSeq: null,
    });
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
    resetStore();
    globalThis.fetch = vi.fn();
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe('PlaygroundEntry — file drop', () => {
    it('loads a valid export when a file is dropped', async () => {
        render(<PlaygroundEntry />);
        const file = new File([JSON.stringify(validExport)], 'session.json', {
            type: 'application/json',
        });
        const dropZone = screen.getByLabelText(/Drop session export/i);
        await act(async () => {
            fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
        });
        await waitFor(() => {
            expect(useMessagesStore.getState().session?.id).toBe(42);
        });
    });

    it('shows an error message when the dropped file is malformed', async () => {
        render(<PlaygroundEntry />);
        const file = new File(['{not json'], 'broken.json', {
            type: 'application/json',
        });
        const dropZone = screen.getByLabelText(/Drop session export/i);
        await act(async () => {
            fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
        });
        expect(await screen.findByText(/broken\.json:.*invalid JSON/i)).toBeInTheDocument();
        expect(useMessagesStore.getState().session).toBeNull();
    });
});

describe('PlaygroundEntry — URL input', () => {
    it('rejects a disallowed host before issuing the request', async () => {
        render(<PlaygroundEntry />);
        const url = 'https://example.com/x.json';
        fireEvent.change(screen.getByLabelText(/Load session from URL/i), {
            target: { value: url },
        });
        fireEvent.click(screen.getByRole('button', { name: /load/i }));
        expect(await screen.findByText(new RegExp(`${url}:.*allowlist`, 'i'))).toBeInTheDocument();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('loads from an allowed gist URL', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(validExport),
        } as Response);

        render(<PlaygroundEntry />);
        fireEvent.change(screen.getByLabelText(/Load session from URL/i), {
            target: { value: 'https://gist.githubusercontent.com/user/abc/raw/s.json' },
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /load/i }));
        });
        await waitFor(() => {
            expect(useMessagesStore.getState().session?.id).toBe(42);
        });
    });
});

describe('PlaygroundEntry — initialUrl boot', () => {
    it('fetches the initialUrl exactly once on mount', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(validExport),
        } as Response);

        await act(async () => {
            render(
                <PlaygroundEntry initialUrl="https://raw.githubusercontent.com/u/r/main/s.json" />,
            );
        });
        await waitFor(() => {
            expect(useMessagesStore.getState().session?.id).toBe(42);
        });
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});
