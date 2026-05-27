import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';
import { DetailPanel } from './DetailPanel';
import { useMessagesStore } from '../store/messagesStore';

function msg(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq: 1,
        timestamp: Date.UTC(2026, 0, 1, 12, 0, 0, 0),
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: 1,
        raw: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}',
        payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
        ...overrides,
    } as CapturedMessage;
}

beforeEach(() => {
    useMessagesStore.setState({ detailTab: 'tree' });
});

describe('DetailPanel — empty state', () => {
    it('shows a placeholder when no message is selected', () => {
        render(<DetailPanel message={null} />);
        expect(screen.getByText(/select a message to inspect/i)).toBeInTheDocument();
    });
});

describe('DetailPanel — header fields', () => {
    it('renders direction, seq, method, kind, and id', () => {
        render(<DetailPanel message={msg()} />);
        // The default Tree tab also renders "initialize" inside the JsonTree
        // value column — assert at least one occurrence rather than exactly one.
        expect(screen.getAllByText(/initialize/).length).toBeGreaterThan(0);
        expect(screen.getByText('seq 1')).toBeInTheDocument();
        expect(screen.getAllByText('kind').length).toBeGreaterThan(0);
        expect(screen.getAllByText('id').length).toBeGreaterThan(0);
    });

    it('shows latency when latencyMs is provided', () => {
        render(<DetailPanel message={msg()} latencyMs={742} />);
        expect(screen.getByText('+742ms')).toBeInTheDocument();
    });

    it('renders a clickable paired-seq link when pairedRequest is set', () => {
        const onJump = vi.fn();
        const response = msg({ kind: 'response' });
        const pairedReq = msg({ seq: 5, method: 'session/prompt' });
        render(
            <DetailPanel
                message={response}
                pairedRequest={pairedReq}
                onJumpToPaired={onJump}
            />,
        );
        const link = screen.getByRole('button', { name: /seq 5/ });
        fireEvent.click(link);
        expect(onJump).toHaveBeenCalledWith(5);
    });
});

describe('DetailPanel — tab switching', () => {
    it('starts on the tab from the store', () => {
        useMessagesStore.setState({ detailTab: 'raw' });
        const m = msg();
        render(<DetailPanel message={m} />);
        // Raw tab shows the literal raw text
        expect(screen.getByText(m.raw)).toBeInTheDocument();
    });

    it('clicking Raw switches to raw view', () => {
        const m = msg();
        render(<DetailPanel message={m} />);
        fireEvent.click(screen.getByRole('button', { name: /^Raw$/ }));
        expect(screen.getByText(m.raw)).toBeInTheDocument();
        expect(useMessagesStore.getState().detailTab).toBe('raw');
    });

    it('clicking Meta switches to meta view with seq/direction/kind rows', () => {
        const m = msg({ seq: 42 });
        render(<DetailPanel message={m} />);
        fireEvent.click(screen.getByRole('button', { name: /^Meta$/ }));
        expect(screen.getByText('42')).toBeInTheDocument(); // seq value
        expect(screen.getByText('editor-to-agent')).toBeInTheDocument();
        expect(useMessagesStore.getState().detailTab).toBe('meta');
    });

    it('clicking Tree switches back to tree view', () => {
        useMessagesStore.setState({ detailTab: 'raw' });
        render(<DetailPanel message={msg()} />);
        fireEvent.click(screen.getByRole('button', { name: /^Tree$/ }));
        // Tree view renders the JSON keys (e.g. "method": …)
        expect(screen.getByText(/"method":/)).toBeInTheDocument();
        expect(useMessagesStore.getState().detailTab).toBe('tree');
    });

    it('responds to external store updates that change the tab', () => {
        render(<DetailPanel message={msg()} />);
        act(() => {
            useMessagesStore.setState({ detailTab: 'meta' });
        });
        // After switching to meta, the meta-only entries show
        expect(screen.getByText('parse error')).toBeInTheDocument();
    });
});

describe('DetailPanel — tree view parse errors', () => {
    it('renders a parse-error block when payload is null', () => {
        const broken = msg({
            payload: null,
            parseError: 'unexpected token',
            raw: '<<<garbage>>>',
        });
        render(<DetailPanel message={broken} />);
        expect(screen.getByText(/parse error: unexpected token/i)).toBeInTheDocument();
        expect(screen.getByText(/<<<garbage>>>/)).toBeInTheDocument();
    });
});
