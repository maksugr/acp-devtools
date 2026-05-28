import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionRecord } from '@acp-devtools/core';
import { TopBar } from './TopBar';
import { useMessagesStore } from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';

const session = {
    id: 1,
    name: null,
    agentCommand: 'mock',
    startedAt: Date.now() - 1000,
    endedAt: null,
    clientName: 'Zed',
    importedAt: null,
} as unknown as SessionRecord;

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
    const onOpenInfo = vi.fn();
    const onOpenPerf = vi.fn();
    const onOpenDiff = vi.fn();
    render(
        <TopBar
            wsUrl="ws://127.0.0.1:3737"
            overrideUrl={null}
            activeUrl={null}
            isReplay={false}
            onPickCapture={() => {}}
            onOpenInfo={onOpenInfo}
            onOpenPerf={onOpenPerf}
            onOpenDiff={onOpenDiff}
            {...overrides}
        />,
    );
    return { onOpenInfo, onOpenPerf, onOpenDiff };
}

beforeEach(() => {
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [],
        selectedUrl: null,
        lastFetchAt: Date.now(),
        lastError: null,
    });
    useMessagesStore.setState({
        session,
        connection: 'open',
        lastError: null,
        messages: [],
    });
});

describe('TopBar', () => {
    it('renders the wordmark and the live session header', () => {
        renderTopBar();
        expect(screen.getByText('acp.devtools')).toBeInTheDocument();
        expect(screen.getByText('SESSION')).toBeInTheDocument();
        expect(screen.getByText('#1')).toBeInTheDocument();
    });

    it('opens the info and perf drawers', () => {
        const { onOpenInfo, onOpenPerf } = renderTopBar();
        fireEvent.click(screen.getByRole('button', { name: /open session info/i }));
        fireEvent.click(screen.getByRole('button', { name: /open performance dashboard/i }));
        expect(onOpenInfo).toHaveBeenCalled();
        expect(onOpenPerf).toHaveBeenCalled();
    });

    it('exposes diff as a button alongside info and perf', () => {
        const { onOpenDiff } = renderTopBar();
        fireEvent.click(screen.getByRole('button', { name: /open session diff/i }));
        expect(onOpenDiff).toHaveBeenCalled();
    });

    it('keeps only import and export in the actions menu', () => {
        renderTopBar();
        fireEvent.click(screen.getByRole('button', { name: /session actions/i }));
        const items = screen.getAllByRole('menuitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent(/import/i);
        expect(items[1]).toHaveTextContent(/export/i);
    });
});
