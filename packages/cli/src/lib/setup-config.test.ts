import { describe, expect, it } from 'vitest';
import {
    EDITORS,
    buildSetupPlan,
    deriveCustomName,
    detectFormatting,
    editorInfo,
    isEditor,
    mergeIntoConfig,
    renderConfigBlock,
} from './setup-config.js';

const SELF = '/opt/homebrew/bin/acp-devtools';

describe('isEditor / EDITORS', () => {
    it('accepts the supported editors and rejects others', () => {
        expect(EDITORS).toEqual(['zed', 'jetbrains']);
        expect(isEditor('zed')).toBe(true);
        expect(isEditor('jetbrains')).toBe(true);
        expect(isEditor('vscode')).toBe(false);
        expect(isEditor('')).toBe(false);
    });
});

describe('editorInfo', () => {
    it('marks JetBrains as a dedicated file and Zed as a shared settings file', () => {
        expect(editorInfo('jetbrains').dedicatedFile).toBe(true);
        expect(editorInfo('zed').dedicatedFile).toBe(false);
    });
    it('resolves a non-empty config path for each editor', () => {
        expect(editorInfo('zed').configPath).toMatch(/settings\.json$/);
        expect(editorInfo('jetbrains').configPath).toMatch(/acp\.json$/);
    });
});

describe('deriveCustomName', () => {
    it('skips npx flags to the package name', () => {
        expect(deriveCustomName(['npx', '-y', '@foo/acp'])).toBe('@foo/acp');
        expect(deriveCustomName(['npx', '--yes', 'my-agent'])).toBe('my-agent');
    });
    it('takes the basename of a path command', () => {
        expect(deriveCustomName(['/abs/path/to/my-agent', 'acp'])).toBe('my-agent');
        expect(deriveCustomName(['agent'])).toBe('agent');
    });
});

describe('buildSetupPlan', () => {
    it('resolves a registry shortcut to the bare-shortcut form', () => {
        const plan = buildSetupPlan({ target: ['junie'], editor: 'zed', selfPath: SELF });
        expect(plan.isCustom).toBe(false);
        expect(plan.entry).toEqual({ type: 'custom', command: SELF, args: ['junie'] });
        expect(plan.displayName).toBe('Junie (via ACP Devtools)');
        expect(plan.requiresExternalInstall).toBe(true);
        expect(plan.agentDescription).toMatch(/junie/i);
    });
    it('flags npx-based shortcuts as not requiring an external install', () => {
        const plan = buildSetupPlan({ target: ['codex'], editor: 'zed', selfPath: SELF });
        expect(plan.requiresExternalInstall).toBe(false);
    });
    it('defaults an empty target to the registry default agent', () => {
        const plan = buildSetupPlan({ target: [], editor: 'jetbrains', selfPath: SELF });
        expect(plan.isCustom).toBe(false);
        expect(plan.entry.args).toEqual(['claude-code']);
    });
    it('wraps a non-shortcut command via proxy', () => {
        const plan = buildSetupPlan({
            target: ['npx', '-y', '@foo/acp'],
            editor: 'zed',
            selfPath: SELF,
        });
        expect(plan.isCustom).toBe(true);
        expect(plan.entry.args).toEqual(['proxy', 'npx', '-y', '@foo/acp']);
        expect(plan.displayName).toBe('@foo/acp (via ACP Devtools)');
    });
    it('treats a single unknown token as a custom command, not a shortcut', () => {
        const plan = buildSetupPlan({ target: ['mystery'], editor: 'zed', selfPath: SELF });
        expect(plan.isCustom).toBe(true);
        expect(plan.entry.args).toEqual(['proxy', 'mystery']);
    });
    it('honours an explicit --name override', () => {
        const plan = buildSetupPlan({
            target: ['junie'],
            editor: 'zed',
            selfPath: SELF,
            name: 'My Junie',
        });
        expect(plan.displayName).toBe('My Junie');
    });
});

describe('renderConfigBlock', () => {
    it('emits a full file for JetBrains and a fragment for Zed', () => {
        const jb = buildSetupPlan({ target: ['junie'], editor: 'jetbrains', selfPath: SELF });
        const zed = buildSetupPlan({ target: ['junie'], editor: 'zed', selfPath: SELF });
        expect(renderConfigBlock(jb).startsWith('{')).toBe(true);
        expect(JSON.parse(renderConfigBlock(jb)).agent_servers).toBeDefined();
        expect(renderConfigBlock(zed).startsWith('"agent_servers"')).toBe(true);
    });
});

describe('mergeIntoConfig', () => {
    const entry = { type: 'custom' as const, command: SELF, args: ['junie'] };

    it('creates the structure from nothing', () => {
        const { text, replaced } = mergeIntoConfig(null, 'Junie', entry);
        expect(replaced).toBe(false);
        expect(JSON.parse(text)).toEqual({ agent_servers: { Junie: entry } });
    });
    it('preserves sibling keys and other agents', () => {
        const existing = JSON.stringify({
            theme: 'dark',
            agent_servers: { Other: { type: 'custom', command: 'x', args: [] } },
        });
        const { text, replaced } = mergeIntoConfig(existing, 'Junie', entry);
        const parsed = JSON.parse(text);
        expect(replaced).toBe(false);
        expect(parsed.theme).toBe('dark');
        expect(Object.keys(parsed.agent_servers)).toEqual(['Other', 'Junie']);
    });
    it('reports replaced=true when overwriting an existing name', () => {
        const existing = JSON.stringify({
            agent_servers: { Junie: { type: 'custom', command: 'old', args: [] } },
        });
        const { text, replaced } = mergeIntoConfig(existing, 'Junie', entry);
        expect(replaced).toBe(true);
        expect(JSON.parse(text).agent_servers.Junie).toEqual(entry);
    });
    it('preserves comments, 2-space indentation, and untouched siblings', () => {
        const existing = [
            '{',
            '  "agent_servers": {',
            '    // my main profile',
            '    "Other": {',
            '      "type": "custom",',
            '      "command": "x",',
            '      "args": ["a", "b"]',
            '    }',
            '  }',
            '}',
            '',
        ].join('\n');
        const { text, replaced } = mergeIntoConfig(existing, 'Junie', entry);
        expect(replaced).toBe(false);
        // Comment survives, the sibling's single-line args is byte-preserved,
        // and the file stays 2-space (no 4-space reflow).
        expect(text).toContain('// my main profile');
        expect(text).toContain('      "args": ["a", "b"]');
        expect(text).toContain('    "Junie": {');
        expect(text).not.toContain('        "type"'); // would be 8-space under a 4-space reflow
        // Still valid and contains both entries.
        const parsed = JSON.parse(text.replace('// my main profile', ''));
        expect(Object.keys(parsed.agent_servers)).toEqual(['Other', 'Junie']);
    });
    it('matches tab indentation when the file uses tabs', () => {
        const existing =
            '{\n\t"agent_servers": {\n\t\t"X": { "type": "custom", "command": "x", "args": [] }\n\t}\n}\n';
        const { text } = mergeIntoConfig(existing, 'Junie', entry);
        expect(text).toContain('\n\t\t"Junie":');
    });
    it('throws when the root is not an object', () => {
        expect(() => mergeIntoConfig('[]', 'Junie', entry)).toThrow(/not a JSON object/);
    });
    it('throws on genuinely malformed JSON (not comments)', () => {
        expect(() => mergeIntoConfig('{ "agent_servers": { "a": } }', 'Junie', entry)).toThrow(
            /not valid JSON/,
        );
    });
});

describe('detectFormatting', () => {
    it('reads the existing indent unit', () => {
        expect(detectFormatting('{\n  "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 2 });
        expect(detectFormatting('{\n    "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 4 });
        expect(detectFormatting('{\n\t"a": 1\n}')).toEqual({ insertSpaces: false, tabSize: 1 });
    });
    it('defaults to 4 spaces for a file with no indentation', () => {
        expect(detectFormatting('{}')).toEqual({ insertSpaces: true, tabSize: 4 });
    });
});
