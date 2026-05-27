import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';
import { SessionInfoPanel } from './SessionInfoPanel';
import { useMessagesStore } from '../store/messagesStore';

const sessionFixture = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id: 21,
    name: null,
    agentCommand: 'npx -y @agentclientprotocol/claude-agent-acp',
    startedAt: Date.UTC(2026, 0, 1, 12, 0, 0, 0),
    endedAt: null,
    clientName: 'Zed',
    importedAt: null,
    clientVersion: null,
    clientPlatform: null,
    agentName: null,
    agentVersion: null,
    protocolVersion: null,
    currentMode: null,
    currentModel: null,
    agentCapabilitiesJson: null,
    ...overrides,
});

const initRequest: CapturedMessage = {
    seq: 1,
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 0, 0),
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: '1',
    raw: '{}',
    payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: true,
                auth: { terminal: true },
            },
        },
    } as unknown as CapturedMessage['payload'],
};

const initResponse: CapturedMessage = {
    seq: 2,
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 1, 0),
    direction: 'agent-to-editor',
    kind: 'response',
    rpcId: '1',
    raw: '{}',
    payload: {
        jsonrpc: '2.0',
        id: 1,
        result: {
            protocolVersion: 1,
            agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
            agentCapabilities: { loadSession: true },
            authMethods: [{ id: 'oauth' }, { id: 'apikey' }],
        },
    } as unknown as CapturedMessage['payload'],
};

beforeEach(() => {
    useMessagesStore.setState({ session: null, messages: [] });
});

describe('SessionInfoPanel — visibility', () => {
    it('renders nothing when open=false', () => {
        useMessagesStore.setState({ session: sessionFixture(), messages: [initRequest] });
        const { container } = render(
            <SessionInfoPanel open={false} onClose={vi.fn()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('shows a placeholder when there is no session attached', () => {
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText(/no session attached/i)).toBeInTheDocument();
    });
});

describe('SessionInfoPanel — summary section', () => {
    it('renders session id and client / agent labels derived from initialize', () => {
        useMessagesStore.setState({
            session: sessionFixture(),
            messages: [initRequest, initResponse],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText('Session')).toBeInTheDocument();
        expect(screen.getByText('#21')).toBeInTheDocument();
        // Client label uses the title from initialize payload.
        expect(screen.getByText('Zed')).toBeInTheDocument();
        // Agent name comes from the initialize response's agentInfo.
        expect(screen.getByText('claude-agent-acp')).toBeInTheDocument();
        // Protocol version is rendered as "ACP v1".
        expect(screen.getByText(/acp v1/i)).toBeInTheDocument();
    });

    it('counts request / response / notification / error frames', () => {
        const notif: CapturedMessage = {
            seq: 3,
            timestamp: 0,
            direction: 'agent-to-editor',
            kind: 'notification',
            method: 'session/update',
            raw: '{}',
            payload: null,
        };
        useMessagesStore.setState({
            session: sessionFixture(),
            messages: [initRequest, initResponse, notif],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText(/3 \(req 1 · rsp 1 · ntf 1 · err 0\)/)).toBeInTheDocument();
    });
});

describe('SessionInfoPanel — capabilities sections', () => {
    it('renders client capability rows with ✓/— glyphs from the initialize payload', () => {
        useMessagesStore.setState({
            session: sessionFixture(),
            messages: [initRequest],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText('fs.readTextFile')).toBeInTheDocument();
        expect(screen.getByText('fs.writeTextFile')).toBeInTheDocument();
        // terminal is true → "enabled"; auth.gateway is missing → "not advertised".
        const enabledRows = screen.getAllByText(/enabled/);
        const muteRows = screen.getAllByText(/not advertised/);
        expect(enabledRows.length).toBeGreaterThan(0);
        expect(muteRows.length).toBeGreaterThan(0);
    });

    it('surfaces agent capabilities + auth methods count', () => {
        useMessagesStore.setState({
            session: sessionFixture(),
            messages: [initRequest, initResponse],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText('loadSession')).toBeInTheDocument();
        expect(screen.getByText('Auth methods')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });
});

describe('SessionInfoPanel — JetBrains extensions', () => {
    it('shows the JetBrains extensions section only when proxyConfig is present', () => {
        const webstormInit: CapturedMessage = {
            ...initRequest,
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
                        _meta: { platform: 'intellij' },
                    },
                    clientCapabilities: { fs: { readTextFile: true } },
                    _meta: { proxyConfig: { proxies: [{ host: '127.0.0.1', port: 50000 }] } },
                },
            } as unknown as CapturedMessage['payload'],
        };
        useMessagesStore.setState({
            session: sessionFixture({ clientName: 'WebStorm 2026.1.2' }),
            messages: [webstormInit],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.getByText('JetBrains extensions')).toBeInTheDocument();
    });

    it('omits the JetBrains section for Zed (no proxyConfig)', () => {
        useMessagesStore.setState({
            session: sessionFixture(),
            messages: [initRequest],
        });
        render(<SessionInfoPanel open={true} onClose={vi.fn()} />);
        expect(screen.queryByText('JetBrains extensions')).not.toBeInTheDocument();
    });
});

describe('SessionInfoPanel — close interactions', () => {
    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        useMessagesStore.setState({ session: sessionFixture(), messages: [initRequest] });
        render(<SessionInfoPanel open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close session info panel/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape keypress', () => {
        const onClose = vi.fn();
        useMessagesStore.setState({ session: sessionFixture(), messages: [initRequest] });
        render(<SessionInfoPanel open={true} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        useMessagesStore.setState({ session: sessionFixture(), messages: [initRequest] });
        const { container } = render(<SessionInfoPanel open={true} onClose={onClose} />);
        const backdrop = container.firstChild as HTMLElement;
        fireEvent.mouseDown(backdrop, { target: backdrop });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
