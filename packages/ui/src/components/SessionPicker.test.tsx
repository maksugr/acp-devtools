import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { ActiveCapture } from '@acp-devtools/core';
import { SessionPicker } from './SessionPicker';
import { useDiscoveryStore } from '../store/discoveryStore';
import type { SavedSession } from '../api/sessions';

const capture = (overrides: Partial<ActiveCapture> = {}): ActiveCapture => ({
    version: 1,
    pid: 1000,
    host: '127.0.0.1',
    port: 50000,
    url: 'ws://127.0.0.1:50000',
    agentCommand: 'npx -y @agentclientprotocol/claude-agent-acp',
    sessionName: null,
    sessionDbId: null,
    saveTo: null,
    startedAt: Date.now() - 60_000,
    clientName: null,
    ...overrides,
});

const saved = (overrides: Partial<SavedSession> = {}): SavedSession => ({
    id: 1,
    name: null,
    agent_command: 'npx -y @agentclientprotocol/claude-agent-acp',
    started_at: Date.now() - 86_400_000,
    ended_at: Date.now() - 86_300_000,
    message_count: 12,
    client_name: null,
    ...overrides,
});

beforeEach(() => {
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [],
        selectedUrl: null,
        lastFetchAt: Date.now(),
        lastError: null,
    });
});

describe('SessionPicker — closed state', () => {
    it('shows "no captures" when nothing is discovered or saved', () => {
        render(<SessionPicker onSelect={() => {}} activeUrl={null} overrideUrl={null} />);
        expect(screen.getByText('no captures')).toBeInTheDocument();
    });

    it('shows "?ws override" when overrideUrl is set', () => {
        render(
            <SessionPicker
                onSelect={() => {}}
                activeUrl={null}
                overrideUrl="ws://override:9999"
            />,
        );
        expect(screen.getByText('?ws override')).toBeInTheDocument();
    });

    it('shows the live capture label when one is active', () => {
        act(() => {
            useDiscoveryStore.setState({
                captures: [
                    capture({
                        url: 'ws://127.0.0.1:50000',
                        clientName: 'Zed',
                        sessionDbId: 7,
                    }),
                ],
            });
        });
        render(
            <SessionPicker
                onSelect={() => {}}
                activeUrl="ws://127.0.0.1:50000"
                overrideUrl={null}
            />,
        );
        expect(screen.getByText('#7 · Zed · Claude Code')).toBeInTheDocument();
    });
});

describe('SessionPicker — dropdown', () => {
    it('opens the panel when the trigger is clicked', () => {
        act(() => {
            useDiscoveryStore.setState({
                captures: [capture()],
            });
        });
        render(<SessionPicker onSelect={() => {}} activeUrl={null} overrideUrl={null} />);
        // Dropdown content is hidden initially
        expect(screen.queryByText(/live captures/i)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /pick capture/i }));
        expect(screen.getByText(/live captures/i)).toBeInTheDocument();
    });

    it('lists each live capture with its client + agent label', () => {
        act(() => {
            useDiscoveryStore.setState({
                captures: [
                    capture({
                        url: 'ws://127.0.0.1:50001',
                        sessionDbId: 11,
                        clientName: 'WebStorm 2026.1.2',
                    }),
                ],
            });
        });
        render(<SessionPicker onSelect={() => {}} activeUrl={null} overrideUrl={null} />);
        fireEvent.click(screen.getByRole('button', { name: /pick capture/i }));
        expect(screen.getByText(/WebStorm 2026.1.2 · Claude Code/)).toBeInTheDocument();
    });

    it('calling onSelect with the capture url + closing the panel', () => {
        const onSelect = vi.fn();
        act(() => {
            useDiscoveryStore.setState({
                captures: [capture({ url: 'ws://127.0.0.1:50002', sessionDbId: 3 })],
            });
        });
        render(<SessionPicker onSelect={onSelect} activeUrl={null} overrideUrl={null} />);
        fireEvent.click(screen.getByRole('button', { name: /pick capture/i }));
        fireEvent.click(screen.getByRole('button', { name: /#3/ }));
        expect(onSelect).toHaveBeenCalledWith('ws://127.0.0.1:50002');
        // Dropdown closed afterwards
        expect(screen.queryByText(/live captures/i)).toBeNull();
    });

    it('hides saved sessions that are still live (dedup by sessionDbId)', () => {
        act(() => {
            useDiscoveryStore.setState({
                captures: [capture({ sessionDbId: 5 })],
                savedSessions: [saved({ id: 5 }), saved({ id: 6 })],
            });
        });
        render(<SessionPicker onSelect={() => {}} activeUrl={null} overrideUrl={null} />);
        fireEvent.click(screen.getByRole('button', { name: /pick capture/i }));
        // Saved section header is followed by exactly the non-live session(s).
        // #5 is live so should NOT appear in saved section.
        const headers = screen.getAllByText(/saved · 1 session/i);
        expect(headers.length).toBeGreaterThan(0);
        expect(screen.getByText(/#6/)).toBeInTheDocument();
    });

    it('renders empty-saved message when captures.db has rows but all are live', () => {
        act(() => {
            useDiscoveryStore.setState({
                captures: [capture({ sessionDbId: 5 })],
                savedSessions: [saved({ id: 5 })],
            });
        });
        render(<SessionPicker onSelect={() => {}} activeUrl={null} overrideUrl={null} />);
        fireEvent.click(screen.getByRole('button', { name: /pick capture/i }));
        expect(
            screen.getByText(/all saved sessions are currently live/i),
        ).toBeInTheDocument();
    });

    it('renders the override-warning footer when overrideUrl is set and panel open', () => {
        render(
            <SessionPicker
                onSelect={() => {}}
                activeUrl={null}
                overrideUrl="ws://override:9999"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /\?ws override/i }));
        expect(screen.getByText(/discovery selection ignored/i)).toBeInTheDocument();
    });
});
