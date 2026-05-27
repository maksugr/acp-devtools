import { describe, expect, it } from 'vitest';
import type { ActiveCapture, SessionRecord } from '@acp-devtools/core';
import { captureLabel, sessionHeader, shortAgentName } from './captureLabel';

describe('shortAgentName', () => {
    it('resolves a known agent shortcut to its display name', () => {
        expect(shortAgentName('npx -y @agentclientprotocol/claude-agent-acp')).toBe('Claude Code');
        expect(shortAgentName('npx -y @zed-industries/codex-acp')).toBe('Codex');
        expect(shortAgentName('goose acp')).toBe('Goose');
        expect(shortAgentName('opencode acp')).toBe('OpenCode');
    });
    it('resolves deprecated aliases to the canonical display name', () => {
        // The old Zed-scoped Claude Code package is still common in existing
        // captures; the alias keeps the label friendly.
        expect(shortAgentName('npx -y @zed-industries/claude-code-acp')).toBe('Claude Code');
    });
    it('strips npx -y wrapper to the package name for unknown agents', () => {
        expect(shortAgentName('npx -y @some-org/random-acp')).toBe('@some-org/random-acp');
        expect(shortAgentName('npx -y my-custom-agent')).toBe('my-custom-agent');
    });
    it('skips multiple flags before the package', () => {
        expect(shortAgentName('npx --yes --quiet some-package')).toBe('some-package');
    });
    it('returns just the script filename for node invocations', () => {
        expect(shortAgentName('node /home/user/mock-agent.js')).toBe('mock-agent.js');
        expect(shortAgentName('node mock.js')).toBe('mock.js');
    });
    it('falls back to the first token for plain commands', () => {
        expect(shortAgentName('goose')).toBe('goose');
        expect(shortAgentName('/usr/bin/claude')).toBe('/usr/bin/claude');
    });
    it('handles empty string', () => {
        expect(shortAgentName('')).toBe('');
    });
});

const capture = (overrides: Partial<ActiveCapture> = {}): ActiveCapture => ({
    version: 1,
    pid: 1234,
    host: '127.0.0.1',
    port: 53000,
    url: 'ws://127.0.0.1:53000',
    agentCommand: 'npx -y @zed-industries/claude-code-acp',
    sessionName: null,
    sessionDbId: null,
    saveTo: null,
    startedAt: Date.now(),
    clientName: null,
    ...overrides,
});

describe('captureLabel', () => {
    it('uses #N when sessionDbId is set', () => {
        expect(captureLabel(capture({ sessionDbId: 7 }))).toBe('#7 · Claude Code');
    });
    it('falls back to pid when no sessionDbId', () => {
        expect(captureLabel(capture({ pid: 999, sessionDbId: null }))).toBe(
            'pid 999 · Claude Code',
        );
    });
    it('uses sessionName when provided', () => {
        expect(captureLabel(capture({ sessionDbId: 5, sessionName: 'Claude Personal' }))).toBe(
            '#5 · Claude Personal',
        );
    });
    it('prepends clientName before the agent label when known', () => {
        expect(captureLabel(capture({ sessionDbId: 7, clientName: 'Zed' }))).toBe(
            '#7 · Zed · Claude Code',
        );
        expect(
            captureLabel(capture({ sessionDbId: 7, clientName: 'WebStorm 2026.1.2' })),
        ).toBe('#7 · WebStorm 2026.1.2 · Claude Code');
    });
    it('sessionName overrides clientName-prefixed agent label', () => {
        expect(
            captureLabel(
                capture({ sessionDbId: 7, sessionName: 'demo', clientName: 'Zed' }),
            ),
        ).toBe('#7 · demo');
    });
});

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id: 5,
    name: null,
    agentCommand: 'npx -y @zed-industries/claude-code-acp',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    clientName: null,
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

describe('sessionHeader', () => {
    it('renders id and short agent name', () => {
        const { primary, secondary } = sessionHeader(session({ id: 12 }));
        expect(primary).toBe('#12');
        expect(secondary).toBe('Claude Code');
    });
    it('prepends clientName when known', () => {
        const { secondary } = sessionHeader(session({ id: 12, clientName: 'Zed' }));
        expect(secondary).toBe('Zed · Claude Code');
    });
    it('shows "ephemeral" for id 0 (no SQLite session)', () => {
        const { primary } = sessionHeader(session({ id: 0 }));
        expect(primary).toBe('ephemeral');
    });
    it('uses sessionName when present', () => {
        const { secondary } = sessionHeader(session({ name: 'work-chat' }));
        expect(secondary).toBe('work-chat');
    });
});
