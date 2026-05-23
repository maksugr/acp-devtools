import { describe, expect, it } from 'vitest';
import type { ActiveCapture, SessionRecord } from '@acp-devtools/core';
import { captureLabel, sessionHeader, shortAgentName } from './captureLabel';

describe('shortAgentName', () => {
    it('strips npx -y wrapper to the package name', () => {
        expect(shortAgentName('npx -y @zed-industries/claude-code-acp')).toBe(
            '@zed-industries/claude-code-acp',
        );
        expect(shortAgentName('npx -y goose')).toBe('goose');
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
    ...overrides,
});

describe('captureLabel', () => {
    it('uses #N when sessionDbId is set', () => {
        expect(captureLabel(capture({ sessionDbId: 7 }))).toBe(
            '#7 · @zed-industries/claude-code-acp',
        );
    });
    it('falls back to pid when no sessionDbId', () => {
        expect(captureLabel(capture({ pid: 999, sessionDbId: null }))).toBe(
            'pid 999 · @zed-industries/claude-code-acp',
        );
    });
    it('uses sessionName when provided', () => {
        expect(captureLabel(capture({ sessionDbId: 5, sessionName: 'Claude Personal' }))).toBe(
            '#5 · Claude Personal',
        );
    });
});

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id: 5,
    name: null,
    agentCommand: 'npx -y @zed-industries/claude-code-acp',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    ...overrides,
});

describe('sessionHeader', () => {
    it('renders id and short agent name', () => {
        const { primary, secondary } = sessionHeader(session({ id: 12 }));
        expect(primary).toBe('#12');
        expect(secondary).toBe('@zed-industries/claude-code-acp');
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
