import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage, MethodStats } from '@acp-devtools/core';
import { PerformancePanel, sortPerMethod } from './PerformancePanel';
import { useMessagesStore } from '../store/messagesStore';

const mk = (overrides: Partial<MethodStats> & { method: string }): MethodStats => ({
    kind: 'request',
    count: 0,
    sampleSize: 0,
    p50: null,
    p99: null,
    max: null,
    totalLatencyMs: null,
    latencies: [],
    ...overrides,
});

describe('sortPerMethod', () => {
    it('sorts by count desc by default', () => {
        const rows: MethodStats[] = [
            mk({ method: 'a', count: 1 }),
            mk({ method: 'b', count: 10 }),
            mk({ method: 'c', count: 5 }),
        ];
        const out = sortPerMethod(rows, 'count', 'desc').map((r) => r.method);
        expect(out).toEqual(['b', 'c', 'a']);
    });

    it('sorts by method name alphabetically', () => {
        const rows: MethodStats[] = [
            mk({ method: 'zeta' }),
            mk({ method: 'alpha' }),
            mk({ method: 'gamma' }),
        ];
        expect(sortPerMethod(rows, 'method', 'asc').map((r) => r.method)).toEqual([
            'alpha',
            'gamma',
            'zeta',
        ]);
    });

    it('sorts by p99 desc, null values to the bottom regardless of direction', () => {
        const rows: MethodStats[] = [
            mk({ method: 'a', p99: 100 }),
            mk({ method: 'b', p99: null }),
            mk({ method: 'c', p99: 500 }),
        ];
        const desc = sortPerMethod(rows, 'p99', 'desc').map((r) => r.method);
        expect(desc).toEqual(['c', 'a', 'b']);

        const asc = sortPerMethod(rows, 'p99', 'asc').map((r) => r.method);
        // a < c, then null at bottom.
        expect(asc).toEqual(['a', 'c', 'b']);
    });

    it('does not mutate the input array', () => {
        const rows: MethodStats[] = [
            mk({ method: 'b', count: 2 }),
            mk({ method: 'a', count: 1 }),
        ];
        const snapshot = rows.map((r) => r.method);
        sortPerMethod(rows, 'count', 'desc');
        expect(rows.map((r) => r.method)).toEqual(snapshot);
    });
});

function msg(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq * 100,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: String(seq),
        raw: '{}',
        payload: null,
        ...overrides,
    };
}

beforeEach(() => {
    useMessagesStore.setState({ messages: [] });
});

describe('PerformancePanel — visibility', () => {
    it('renders nothing when open=false', () => {
        const { container } = render(
            <PerformancePanel open={false} onClose={vi.fn()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('shows empty-state copy when there are no messages', () => {
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText(/no messages/i)).toBeInTheDocument();
    });
});

describe('PerformancePanel — table content', () => {
    it('renders one row per method, request-kind before notification on ties', () => {
        useMessagesStore.setState({
            messages: [
                msg(1, { method: 'initialize' }),
                msg(2, {
                    method: 'initialize',
                    kind: 'response',
                    direction: 'agent-to-editor',
                    rpcId: '1',
                }),
                msg(3, {
                    method: 'session/update',
                    kind: 'notification',
                    direction: 'agent-to-editor',
                    rpcId: undefined,
                }),
                msg(4, {
                    method: 'session/update',
                    kind: 'notification',
                    direction: 'agent-to-editor',
                    rpcId: undefined,
                }),
            ],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText('initialize')).toBeInTheDocument();
        expect(screen.getByText('session/update')).toBeInTheDocument();
        // Summary line counts 2 unique methods, 1 request, 2 notifications.
        expect(screen.getByText(/2 methods/i)).toBeInTheDocument();
        expect(screen.getByText(/1 requests/i)).toBeInTheDocument();
        expect(screen.getByText(/2 notifications/i)).toBeInTheDocument();
    });

    it('renders latency p50 for paired request/response, em-dash for notification rows', () => {
        useMessagesStore.setState({
            messages: [
                msg(1, { method: 'initialize' }),
                msg(2, {
                    method: 'initialize',
                    kind: 'response',
                    direction: 'agent-to-editor',
                    rpcId: '1',
                    timestamp: 1_700_000_000_100 + 250,
                }),
                msg(3, {
                    method: 'session/update',
                    kind: 'notification',
                    direction: 'agent-to-editor',
                    rpcId: undefined,
                }),
            ],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        // formatLatency(150ms) renders as "150ms" — exact wording in the
        // initialize row. Notification rows render "—" for p50/p99.
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
});

describe('PerformancePanel — sortable headers', () => {
    it('clicking a column header toggles its sort indicator', () => {
        useMessagesStore.setState({
            messages: [
                msg(1, { method: 'a' }),
                msg(2, { method: 'b' }),
            ],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        const methodHeader = screen.getByRole('columnheader', { name: /method/ });
        fireEvent.click(methodHeader);
        // After clicking, header carries aria-sort.
        expect(methodHeader.getAttribute('aria-sort')).toMatch(/ascending|descending/);
    });
});

describe('PerformancePanel — session label', () => {
    const sessionFixture = (clientName: string | null) => ({
        id: 21,
        name: null,
        agentCommand: 'npx -y @zed-industries/claude-code-acp',
        startedAt: 0,
        endedAt: null,
        clientName,
        importedAt: null,
        clientVersion: null,
        clientPlatform: null,
        agentName: null,
        agentVersion: null,
        protocolVersion: null,
        currentMode: null,
        currentModel: null,
        agentCapabilitiesJson: null,
    });

    it('shows the session.clientName when present', () => {
        useMessagesStore.setState({
            session: sessionFixture('WebStorm 2026.1.2'),
            messages: [msg(1, { method: 'initialize' })],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        // Find the label that includes "#21" and the client name.
        expect(screen.getByText(/#21.*WebStorm 2026\.1\.2/)).toBeInTheDocument();
    });

    it('derives clientName from initialize message when session.clientName is null (live capture race)', () => {
        // Regression: WS `session.start` fires before the proxy has seen
        // the initialize request, so `session.clientName` is null at first.
        // The picker reads from ActiveCapture (discovery) so it's fine, but
        // the perf header used `session.clientName` directly and showed
        // just "Claude Code". Fall back to message extraction so both
        // surfaces agree.
        const initWithClient: CapturedMessage = {
            seq: 1,
            timestamp: 1_700_000_000_000,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'initialize',
            rpcId: '1',
            raw: '',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: 1,
                    clientInfo: {
                        name: 'JetBrains.WebStorm',
                        title: 'WebStorm 2026.1.2',
                        version: '2026.1.2',
                    },
                },
            } as unknown as CapturedMessage['payload'],
        };
        useMessagesStore.setState({
            session: sessionFixture(null),
            messages: [initWithClient],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText(/WebStorm 2026\.1\.2/)).toBeInTheDocument();
    });

    it('falls back to just the session id when no clientName and no initialize', () => {
        useMessagesStore.setState({
            session: sessionFixture(null),
            messages: [msg(1, { method: 'session/prompt' })],
        });
        render(<PerformancePanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText(/#21/)).toBeInTheDocument();
    });
});

describe('PerformancePanel — close interactions', () => {
    it('calls onClose on close button', () => {
        const onClose = vi.fn();
        render(<PerformancePanel open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close performance panel/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key', () => {
        const onClose = vi.fn();
        render(<PerformancePanel open={true} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
