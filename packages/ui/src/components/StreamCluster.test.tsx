import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';
import { StreamCluster } from './StreamCluster';

function chunk(seq: number, text: string, ts: number): CapturedMessage {
    return {
        seq,
        timestamp: ts,
        direction: 'agent-to-editor',
        kind: 'notification',
        method: 'session/update',
        raw: '{}',
        payload: {
            jsonrpc: '2.0',
            method: 'session/update',
            params: { update: { sessionUpdate: 'agent_message_chunk', content: { text } } },
        } as unknown as CapturedMessage['payload'],
    };
}

const messages = [
    chunk(1, 'Hello ', 1000),
    chunk(2, 'there ', 1200),
    chunk(3, 'world', 1800),
];

function renderCluster(overrides: Partial<React.ComponentProps<typeof StreamCluster>> = {}) {
    const onSelect = vi.fn();
    render(
        <StreamCluster
            messages={messages}
            combinedText="Hello there world"
            firstTimestamp={1000}
            lastTimestamp={1800}
            selectedSeq={null}
            onSelect={onSelect}
            {...overrides}
        />,
    );
    return { onSelect };
}

describe('StreamCluster', () => {
    it('summarizes the collapsed run', () => {
        renderCluster();
        expect(screen.getByText('3 chunks')).toBeInTheDocument();
        expect(screen.getByText('001…003')).toBeInTheDocument();
        expect(screen.getByText('Hello there world')).toBeInTheDocument();
        expect(screen.getByText('STR')).toBeInTheDocument();
    });

    it('expands on header click and selects the first chunk', () => {
        const { onSelect } = renderCluster();
        fireEvent.click(screen.getByText('3 chunks').closest('button')!);
        expect(onSelect).toHaveBeenCalledWith(1);
        // Expanded child rows show per-chunk previews.
        expect(screen.getByText('there')).toBeInTheDocument();
    });

    it('selects an individual chunk when a child row is clicked', () => {
        const { onSelect } = renderCluster();
        fireEvent.click(screen.getByText('3 chunks').closest('button')!);
        fireEvent.click(screen.getByText('world'));
        expect(onSelect).toHaveBeenCalledWith(3);
    });
});
