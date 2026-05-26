import { describe, expect, it } from 'vitest';
import {
    AGENT_REGISTRY,
    DEFAULT_AGENT,
    detectAgentShortcut,
    isAgentShortcut,
    listAgents,
    resolveAgent,
} from './registry.js';

describe('AGENT_REGISTRY', () => {
    it('contains the documented shortcuts', () => {
        const keys = Object.keys(AGENT_REGISTRY).sort();
        expect(keys).toEqual(['claude-code', 'codex', 'goose', 'opencode']);
    });
    it('defaults to claude-code', () => {
        expect(DEFAULT_AGENT).toBe('claude-code');
        expect(AGENT_REGISTRY[DEFAULT_AGENT]).toBeDefined();
    });
    it('every entry has required fields', () => {
        for (const def of Object.values(AGENT_REGISTRY)) {
            expect(def.shortName).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(def.displayName.length).toBeGreaterThan(0);
            expect(def.description.length).toBeGreaterThan(0);
            expect(def.command.length).toBeGreaterThan(0);
            expect(Array.isArray(def.args)).toBe(true);
        }
    });
});

describe('resolveAgent', () => {
    it('returns the definition for a known shortname', () => {
        const def = resolveAgent('claude-code');
        expect(def.shortName).toBe('claude-code');
        expect(def.command).toBe('npx');
        expect(def.args).toContain('@agentclientprotocol/claude-agent-acp');
    });
    it('throws a helpful message for unknown shortnames', () => {
        expect(() => resolveAgent('unknown-agent')).toThrow(/unknown agent "unknown-agent"/);
        expect(() => resolveAgent('unknown-agent')).toThrow(/Known shortcuts.*claude-code/);
    });
});

describe('isAgentShortcut', () => {
    it('returns true for registered shortcuts', () => {
        expect(isAgentShortcut('claude-code')).toBe(true);
        expect(isAgentShortcut('codex')).toBe(true);
        expect(isAgentShortcut('goose')).toBe(true);
        expect(isAgentShortcut('opencode')).toBe(true);
    });
    it('returns false for anything else', () => {
        expect(isAgentShortcut('unknown')).toBe(false);
        expect(isAgentShortcut('')).toBe(false);
        expect(isAgentShortcut('npx')).toBe(false);
        expect(isAgentShortcut('Claude-Code')).toBe(false); // case-sensitive
    });
});

describe('listAgents', () => {
    it('returns all registry entries as an array', () => {
        const all = listAgents();
        expect(all).toHaveLength(4);
        expect(all.map((a) => a.shortName).sort()).toEqual([
            'claude-code',
            'codex',
            'goose',
            'opencode',
        ]);
    });
    it('returns a copy that doesn\'t mutate the registry', () => {
        const first = listAgents();
        first.pop();
        const second = listAgents();
        expect(second).toHaveLength(4);
    });
});

describe('detectAgentShortcut', () => {
    it('matches the primary command + args tuple', () => {
        const def = detectAgentShortcut('npx -y @agentclientprotocol/claude-agent-acp');
        expect(def?.shortName).toBe('claude-code');
        expect(def?.displayName).toBe('Claude Code');
    });
    it('matches with extra trailing args (prefix match)', () => {
        const def = detectAgentShortcut('npx -y @agentclientprotocol/claude-agent-acp --foo bar');
        expect(def?.shortName).toBe('claude-code');
    });
    it('matches deprecated aliases', () => {
        const def = detectAgentShortcut('npx -y @zed-industries/claude-code-acp');
        expect(def?.shortName).toBe('claude-code');
        expect(def?.displayName).toBe('Claude Code');
    });
    it('matches goose binary form', () => {
        expect(detectAgentShortcut('goose acp')?.shortName).toBe('goose');
        expect(detectAgentShortcut('opencode acp')?.shortName).toBe('opencode');
        expect(detectAgentShortcut('opencode acp --port 8080')?.shortName).toBe('opencode');
    });
    it('matches codex', () => {
        expect(detectAgentShortcut('npx -y @zed-industries/codex-acp')?.shortName).toBe('codex');
    });
    it('returns null for unknown commands', () => {
        expect(detectAgentShortcut('node my-custom-agent.js')).toBeNull();
        expect(detectAgentShortcut('npx -y @other/random-acp')).toBeNull();
        expect(detectAgentShortcut('')).toBeNull();
        expect(detectAgentShortcut('   ')).toBeNull();
    });
    it('does not match partial commands', () => {
        // The match requires either exact or prefix-followed-by-space — half-word
        // matches must be rejected so `gooseberry foo` doesn't resolve to goose.
        expect(detectAgentShortcut('gooseberry acp')).toBeNull();
        expect(detectAgentShortcut('opencodex acp')).toBeNull();
    });
});
