import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';

// react-virtuoso virtualizes off-screen rows away in jsdom (zero height →
// nothing renders). Replace it with a plain list that renders every item so
// we can assert on the rows Timeline produces.
vi.mock('react-virtuoso', async () => {
    const React = await import('react');
    return {
        Virtuoso: React.forwardRef(
            (
                { totalCount, itemContent }: { totalCount: number; itemContent: (i: number) => React.ReactNode },
                ref: React.Ref<unknown>,
            ) => {
                React.useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }));
                return React.createElement(
                    'div',
                    { 'data-testid': 'virtuoso' },
                    Array.from({ length: totalCount }, (_, i) =>
                        React.createElement('div', { key: i }, itemContent(i)),
                    ),
                );
            },
        ),
    };
});

import { Timeline } from './Timeline';
import { ALL_DIRECTIONS, ALL_KINDS, useMessagesStore } from '../store/messagesStore';

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
        playback: { cap: null, playing: false, speed: 1 },
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
