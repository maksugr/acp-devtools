import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// EmptyState renders IdeSnippets internally, which fires fetchServerInfo on
// mount. Stub it so each test stays deterministic and self-contained.
vi.mock('../api/info', () => ({
    fetchServerInfo: vi.fn().mockResolvedValue({
        binaryPath: '/abs/path/to/acp-devtools',
        platform: 'darwin',
        arch: 'arm64',
    }),
}));

import { EmptyState } from './EmptyState';
import type { ConnectionStatus } from '../store/messagesStore';

beforeEach(() => {
    vi.clearAllMocks();
});

function renderWith(props: Partial<{
    status: ConnectionStatus;
    lastError: string | null;
    url: string;
    captureCount: number;
}> = {}) {
    return render(
        <EmptyState
            status={props.status ?? 'idle'}
            lastError={props.lastError ?? null}
            url={props.url ?? 'ws://127.0.0.1:3737'}
            captureCount={props.captureCount ?? 0}
        />,
    );
}

describe('EmptyState — headlines per status', () => {
    it('shows "Awaiting messages" when open', () => {
        renderWith({ status: 'open' });
        expect(screen.getByText('Awaiting messages')).toBeInTheDocument();
    });
    it('shows "Connecting" when connecting', () => {
        renderWith({ status: 'connecting' });
        expect(screen.getByText('Connecting')).toBeInTheDocument();
    });
    it('shows "Disconnected" when closed', () => {
        renderWith({ status: 'closed' });
        expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
    it('shows "Connection error" when error', () => {
        renderWith({ status: 'error' });
        expect(screen.getByText('Connection error')).toBeInTheDocument();
    });
    it('shows "No live capture" for idle/unknown statuses', () => {
        renderWith({ status: 'idle' });
        expect(screen.getByText('No live capture')).toBeInTheDocument();
    });
});

describe('EmptyState — capture count message', () => {
    it('does not render the discovery line when captureCount is 0', () => {
        renderWith({ captureCount: 0 });
        // The h2 heading "No live capture" can match a loose /live capture/i —
        // be specific to the discovery line by including the "discovered" word.
        expect(screen.queryByText(/discovered — pick one in the picker above/i)).toBeNull();
    });
    it('uses singular form for exactly 1 capture', () => {
        renderWith({ captureCount: 1 });
        expect(
            screen.getByText(/1 live capture discovered — pick one in the picker above/i),
        ).toBeInTheDocument();
    });
    it('uses plural form for 2+ captures', () => {
        renderWith({ captureCount: 3 });
        expect(
            screen.getByText(/3 live captures discovered/i),
        ).toBeInTheDocument();
    });
});

describe('EmptyState — connection details', () => {
    it('renders the WebSocket URL', () => {
        renderWith({ url: 'ws://127.0.0.1:65432' });
        expect(screen.getByText('ws://127.0.0.1:65432')).toBeInTheDocument();
    });
    it('renders lastError text when provided', () => {
        renderWith({ status: 'error', lastError: 'connection refused' });
        expect(screen.getByText('connection refused')).toBeInTheDocument();
    });
    it('does not render an error span when lastError is null', () => {
        const { container } = renderWith({ lastError: null });
        expect(container.querySelector('.text-accent-error')).toBeNull();
    });
});

describe('EmptyState — embeds IdeSnippets', () => {
    it('renders the Zed snippet from IdeSnippets', async () => {
        renderWith();
        // Zed tab is selected by default; its JSON has the agent_server label
        expect(
            await screen.findByText(/Claude Code \(via ACP Devtools\)/),
        ).toBeInTheDocument();
    });
});
