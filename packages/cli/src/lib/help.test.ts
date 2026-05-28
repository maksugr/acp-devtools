import { homedir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram } from '../program.js';
import { GROUPS, SUMMARIES, tidyHome } from './help.js';

// Force colour off so the rendered help is deterministic regardless of the
// test runner's TTY state.
let previousNoColor: string | undefined;
beforeAll(() => {
    previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
});
afterAll(() => {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
});

function commandNames(): string[] {
    return buildProgram()
        .commands.map((c) => c.name())
        .filter((n) => n !== 'help');
}

describe('command grouping', () => {
    it('places every registered command in exactly one group', () => {
        const grouped = GROUPS.flatMap((g) => g.commands);
        const seen = new Set<string>();
        for (const name of grouped) {
            expect(seen.has(name), `${name} appears in more than one group`).toBe(false);
            seen.add(name);
        }
        for (const name of commandNames()) {
            expect(grouped, `${name} is not assigned to a help group`).toContain(name);
        }
    });

    it('only references commands that are actually registered', () => {
        const registered = new Set(commandNames());
        for (const group of GROUPS) {
            for (const name of group.commands) {
                expect(registered.has(name), `group "${group.title}" lists unknown command ${name}`).toBe(
                    true,
                );
            }
        }
    });

    it('gives every command a short summary', () => {
        for (const name of commandNames()) {
            expect(SUMMARIES[name], `${name} has no summary`).toBeTruthy();
        }
    });
});

describe('root overview', () => {
    const help = buildProgram().helpInformation();

    it('shows the wordmark and a grouped, example-rich layout', () => {
        expect(help).toContain('acp.devtools');
        for (const group of GROUPS) {
            expect(help).toContain(group.title.toUpperCase());
        }
        expect(help).toContain('EXAMPLES');
        expect(help).toContain('acp-devtools proxy npx -y @zed-industries/claude-code-acp');
    });

    it('lists each command with its summary', () => {
        for (const [name, summary] of Object.entries(SUMMARIES)) {
            expect(help).toContain(name);
            expect(help).toContain(summary);
        }
    });

    it('emits no ANSI escapes when colour is disabled', () => {
        expect(help.includes(String.fromCharCode(27))).toBe(false);
    });
});

describe('per-command help', () => {
    function helpFor(name: string): string {
        const cmd = buildProgram().commands.find((c) => c.name() === name);
        if (!cmd) throw new Error(`command ${name} not found`);
        return cmd.helpInformation();
    }

    it('renders usage, options and examples for a leaf command', () => {
        const help = helpFor('list');
        expect(help).toContain('USAGE');
        expect(help).toContain('acp-devtools list');
        expect(help).toContain('OPTIONS');
        expect(help).toContain('--db');
        expect(help).toContain('EXAMPLES');
    });

    it('inherits the custom renderer (no commander default "Usage:" line)', () => {
        const help = helpFor('inspect');
        expect(help).toContain('USAGE');
        expect(help).not.toContain('Usage:');
        expect(help).toContain('ARGUMENTS');
    });

    it('collapses the home directory to ~ in the --db default', () => {
        // Only meaningful when the default db lives under $HOME (i.e. no
        // ACP_DEVTOOLS_HOME override pointing elsewhere).
        if (process.env.ACP_DEVTOOLS_HOME) return;
        const help = helpFor('list');
        expect(help).toContain('~/.acp-devtools/captures.db');
        expect(help).not.toContain(`${homedir()}/.acp-devtools`);
    });
});

describe('tidyHome', () => {
    it('replaces the home prefix with ~', () => {
        expect(tidyHome('(default: "/Users/me/.acp-devtools/captures.db")', '/Users/me')).toBe(
            '(default: "~/.acp-devtools/captures.db")',
        );
    });

    it('leaves paths outside home untouched', () => {
        expect(tidyHome('/etc/acp/captures.db', '/Users/me')).toBe('/etc/acp/captures.db');
    });

    it('is a no-op when home is empty', () => {
        expect(tidyHome('/Users/me/x', '')).toBe('/Users/me/x');
    });
});
