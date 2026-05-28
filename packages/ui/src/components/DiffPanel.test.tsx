import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';

vi.mock('../api/sessions', () => ({
    fetchSavedSessions: vi.fn(),
    fetchSessionMessages: vi.fn(),
}));

import { fetchSessionMessages, type SavedSession } from '../api/sessions';
import { DiffPanel } from './DiffPanel';
import { useMessagesStore } from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';

const mockedMessages = vi.mocked(fetchSessionMessages);

let seq = 0;
function req(method: string, params: unknown): CapturedMessage {
    const s = ++seq;
    const payload = { jsonrpc: '2.0' as const, id: s, method, params };
    return {
        seq: s,
        timestamp: 1_700_000_000_000 + s * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method,
        rpcId: s,
        raw: JSON.stringify(payload),
        payload,
    };
}

function savedRow(id: number, name: string): SavedSession {
    return {
        id,
        name,
        agent_command: 'mock',
        started_at: 1_700_000_000_000,
        ended_at: null,
        message_count: 2,
        client_name: 'Zed',
        imported_at: null,
        client_version: null,
        client_platform: null,
        agent_name: null,
        agent_version: null,
        protocol_version: null,
        current_mode: null,
        current_model: null,
    };
}

const recordB: SessionRecord = {
    id: 2,
    name: 'session B',
    agentCommand: 'mock',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    clientName: 'Zed',
    importedAt: null,
} as unknown as SessionRecord;

// A is the active session (#1); its frames live in the messages store.
beforeEach(() => {
    seq = 0;
    mockedMessages.mockReset();
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [savedRow(1, 'session A'), savedRow(2, 'session B')],
        selectedUrl: null,
        lastFetchAt: Date.now(),
        lastError: null,
    });
    useMessagesStore.setState({
        messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'old' })],
        session: { ...recordB, id: 1, name: 'session A' } as SessionRecord,
    });
});

const openA = () => fireEvent.click(screen.getByRole('button', { name: /Baseline session/i }));
const openB = () => fireEvent.click(screen.getByRole('button', { name: /Comparison session/i }));

describe('DiffPanel', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<DiffPanel open={false} onClose={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it('pre-selects A to the session it was opened from', () => {
        render(<DiffPanel open onClose={() => {}} />);
        expect(screen.getByRole('button', { name: /Baseline session/i })).toHaveTextContent(
            'session A',
        );
    });

    it('prompts to pick B when only A is set', () => {
        render(<DiffPanel open onClose={() => {}} />);
        expect(screen.getByText(/Pick a session in the B selector/i)).toBeInTheDocument();
    });

    it('lists saved sessions in the B picker, excluding A', () => {
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        expect(screen.getByTitle(/^session #2 ·/)).toBeInTheDocument();
        expect(screen.queryByTitle(/^session #1 ·/)).not.toBeInTheDocument();
    });

    it('does not offer B’s pick as an A option (no self-compare)', () => {
        mockedMessages.mockResolvedValue({ session: recordB, messages: [req('initialize', { v: 1 })] });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        openA();
        // A now excludes #2 (B's pick); only #1 remains selectable.
        expect(screen.getByTitle(/^session #1 ·/)).toBeInTheDocument();
        expect(screen.queryByTitle(/^session #2 ·/)).not.toBeInTheDocument();
    });

    it('computes and renders the diff after B is picked', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));

        expect(await screen.findByText('1 differs')).toBeInTheDocument();
        expect(screen.getByText('0 only in B')).toBeInTheDocument();
        expect(screen.getByText(/1 field/i)).toBeInTheDocument();
    });

    it('expands field-level changes on click', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));

        const fieldToggle = await screen.findByText(/1 field/i);
        fireEvent.click(fieldToggle);
        expect(await screen.findByText('params.text')).toBeInTheDocument();
    });

    it('hides unchanged frames by default and reveals them via the toggle', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        await screen.findByText('1 differs');

        expect(screen.queryAllByText('initialize')).toHaveLength(0);
        fireEvent.click(screen.getByRole('checkbox'));
        expect((await screen.findAllByText('initialize')).length).toBeGreaterThan(0);
    });

    it('renders added and removed rows with their summary counts', async () => {
        seq = 0;
        useMessagesStore.setState({
            messages: [req('initialize', { v: 1 }), req('only/a', {})],
            session: { ...recordB, id: 1, name: 'session A' } as SessionRecord,
        });
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('only/b', {})],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));

        expect(await screen.findByText('only/a')).toBeInTheDocument();
        expect(screen.getByText('only/b')).toBeInTheDocument();
        expect(screen.getByText('1 only in B')).toBeInTheDocument();
        expect(screen.getByText('1 only in A')).toBeInTheDocument();
    });

    it('shows an "identical" hint when B matches A frame-for-frame', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'old' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        expect(await screen.findByText(/Sessions are identical/i)).toBeInTheDocument();
    });

    it('exposes Frames, Info and Perf tabs once both sides are picked', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        await screen.findByText('1 differs');
        expect(screen.getByRole('button', { name: /frames/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /info/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /perf/i })).toBeInTheDocument();
    });

    it('Info tab compares session metadata', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        await screen.findByText('1 differs');
        fireEvent.click(screen.getByRole('button', { name: /info/i }));
        // The seed has no clientInfo/protocolVersion → metadata is identical.
        expect(await screen.findByText(/Metadata identical/i)).toBeInTheDocument();
    });

    it('Perf tab shows a per-method latency table', async () => {
        seq = 0;
        mockedMessages.mockResolvedValue({
            session: recordB,
            messages: [req('initialize', { v: 1 }), req('session/prompt', { text: 'new' })],
        });
        render(<DiffPanel open onClose={() => {}} />);
        openB();
        fireEvent.click(screen.getByTitle(/^session #2 ·/));
        await screen.findByText('1 differs');
        fireEvent.click(screen.getByRole('button', { name: /perf/i }));
        expect(await screen.findByText('A p99')).toBeInTheDocument();
    });
});
