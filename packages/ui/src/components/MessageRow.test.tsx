import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';
import { MessageRow } from './MessageRow';

function msg(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq: 1,
        timestamp: Date.UTC(2026, 0, 1, 12, 34, 56, 789),
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: 1,
        raw: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
        payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
        ...overrides,
    } as CapturedMessage;
}

describe('MessageRow', () => {
    it('renders seq, method, rpc id, and size for a request', () => {
        const m = msg();
        render(<MessageRow message={m} selected={false} onSelect={() => {}} />);
        expect(screen.getByText('001')).toBeInTheDocument();
        expect(screen.getByText('initialize')).toBeInTheDocument();
        expect(screen.getByText('id:1')).toBeInTheDocument();
        // Byte rendering: under 1KB → "<N>B" (no space)
        expect(screen.getByText(`${m.raw.length}B`)).toBeInTheDocument();
    });

    it('shows the kind badge for each kind', () => {
        const { rerender } = render(
            <MessageRow message={msg({ kind: 'request' })} selected={false} onSelect={() => {}} />,
        );
        expect(screen.getByText('REQ')).toBeInTheDocument();
        rerender(<MessageRow message={msg({ kind: 'response' })} selected={false} onSelect={() => {}} />);
        expect(screen.getByText('RSP')).toBeInTheDocument();
        rerender(
            <MessageRow message={msg({ kind: 'notification' })} selected={false} onSelect={() => {}} />,
        );
        expect(screen.getByText('NTF')).toBeInTheDocument();
        rerender(<MessageRow message={msg({ kind: 'error' })} selected={false} onSelect={() => {}} />);
        expect(screen.getByText('ERR')).toBeInTheDocument();
    });

    it('truncates UUID rpc ids in the visible column but keeps the full id in title', () => {
        const uuid = '074e0266-4a39-4dc6-b9b1-4dfcfc9dfb8d';
        render(<MessageRow message={msg({ rpcId: uuid })} selected={false} onSelect={() => {}} />);
        // Visible text is the truncated form
        expect(screen.getByText('id:074e0266…')).toBeInTheDocument();
        // Full id is reachable via the title attribute on the same span
        const span = screen.getByText('id:074e0266…');
        expect(span.getAttribute('title')).toBe(`id:${uuid}`);
    });

    it('shows latency with a leading + when latencyMs is set', () => {
        render(
            <MessageRow
                message={msg({ kind: 'response' })}
                selected={false}
                latencyMs={1490}
                onSelect={() => {}}
            />,
        );
        expect(screen.getByText('+1.49s')).toBeInTheDocument();
    });

    it('renders no latency when latencyMs is undefined', () => {
        render(<MessageRow message={msg()} selected={false} onSelect={() => {}} />);
        // No element should show a "+" + time pattern when there's no latency
        expect(screen.queryByText(/^\+\d/)).toBeNull();
    });

    it('renders no rpc-id cell when rpcId is missing (notification)', () => {
        const notification = msg({
            kind: 'notification',
            method: 'session/update',
            rpcId: undefined,
        });
        render(<MessageRow message={notification} selected={false} onSelect={() => {}} />);
        expect(screen.queryByText(/^id:/)).toBeNull();
    });

    it('shows the user-prompt preview when isUserPrompt matches', () => {
        const prompt = msg({
            method: 'session/prompt',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'session/prompt',
                params: { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] },
            },
        });
        render(<MessageRow message={prompt} selected={false} onSelect={() => {}} />);
        expect(screen.getByText(/“hi”/)).toBeInTheDocument();
    });

    it('calls onSelect(seq) when clicked', () => {
        const onSelect = vi.fn();
        render(<MessageRow message={msg({ seq: 42 })} selected={false} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onSelect).toHaveBeenCalledWith(42);
    });

    it('applies selected styling ring when selected=true', () => {
        const { container } = render(
            <MessageRow message={msg()} selected={true} onSelect={() => {}} />,
        );
        const btn = container.querySelector('button');
        expect(btn?.className).toMatch(/ring-accent-out/);
    });

    it('applies the paired ring when paired=true and not selected', () => {
        const { container } = render(
            <MessageRow message={msg()} selected={false} paired={true} onSelect={() => {}} />,
        );
        const btn = container.querySelector('button');
        expect(btn?.className).toMatch(/ring-accent-out/);
    });
});
