import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CapturedMessage } from '@acp-devtools/core';
import { StatsBar } from './StatsBar';
import { useMessagesStore } from '../store/messagesStore';

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

/** The wrapping span holds the label and value as adjacent text → "req1". */
function statText(label: string): string {
    return screen.getByText(label).parentElement?.textContent ?? '';
}

beforeEach(() => {
    useMessagesStore.setState({ messages: [], selectedSeq: null });
});

describe('StatsBar', () => {
    it('counts messages by kind', () => {
        useMessagesStore.setState({
            messages: [
                mk(1, { kind: 'request', rpcId: 'a', timestamp: 1000 }),
                mk(2, {
                    kind: 'response',
                    rpcId: 'a',
                    timestamp: 1500,
                    direction: 'agent-to-editor',
                }),
                mk(3, { kind: 'notification', method: 'session/update', rpcId: undefined }),
                mk(4, { kind: 'error', rpcId: 'b' }),
            ],
        });
        render(<StatsBar />);
        expect(statText('msgs')).toBe('msgs4');
        expect(statText('req')).toBe('req1');
        expect(statText('rsp')).toBe('rsp1');
        expect(statText('ntf')).toBe('ntf1');
        expect(statText('err')).toBe('err1');
    });

    it('derives p50 latency from request/response pairs', () => {
        useMessagesStore.setState({
            messages: [
                mk(1, { kind: 'request', rpcId: 'x', timestamp: 1000 }),
                mk(2, {
                    kind: 'response',
                    rpcId: 'x',
                    timestamp: 1500,
                    direction: 'agent-to-editor',
                }),
            ],
        });
        render(<StatsBar />);
        expect(statText('p50')).toContain('500ms');
    });

    it('shows em dashes when there is nothing to measure', () => {
        render(<StatsBar />);
        expect(statText('msgs')).toBe('msgs0');
        expect(statText('p50')).toContain('—');
        expect(statText('bytes')).toContain('—');
    });
});
