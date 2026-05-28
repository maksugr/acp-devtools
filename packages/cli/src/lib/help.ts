import { homedir } from 'node:os';
import type { Command, Help } from 'commander';
import { colorEnabled, createStyler, type Styler } from './style.js';

// Collapse the user's home directory to `~` for display. The actual option
// default stays the absolute path — this only tidies the help text so it
// doesn't leak a username and reads the same on every machine.
export function tidyHome(text: string, home: string = homedir()): string {
    if (!home) return text;
    return text.split(home).join('~');
}

interface CommandGroup {
    title: string;
    commands: string[];
}

// Ordered command groups for the top-level overview. The guard test in
// help.test.ts asserts this stays in sync with the registered commands, so a
// new command without a home here fails CI rather than silently disappearing.
export const GROUPS: CommandGroup[] = [
    { title: 'Capture', commands: ['proxy', 'mock-agent', 'mock-editor'] },
    {
        title: 'Inspect',
        commands: ['list', 'inspect', 'search', 'stats', 'diff', 'session-info', 'validate'],
    },
    { title: 'View', commands: ['ui', 'replay'] },
    { title: 'Manage', commands: ['export', 'import', 'delete', 'backfill-metadata'] },
    { title: 'Setup', commands: ['doctor', 'mcp'] },
];

// One-line summaries shown in the overview. Kept short on purpose — the full
// .description() still shows on each command's own --help.
export const SUMMARIES: Record<string, string> = {
    proxy: "Capture an agent's traffic through a proxy",
    'mock-agent': 'Replay a session as a fake ACP agent',
    'mock-editor': 'Replay a session as a fake editor',
    list: 'List saved sessions, newest first',
    inspect: "Print a session's frames to stdout",
    search: 'Search frame payloads across sessions',
    stats: 'Latency percentiles for one session',
    diff: 'Compare two sessions frame by frame',
    'session-info': "Show a session's client/agent metadata",
    validate: 'Check frames against the ACP spec',
    ui: 'Open the web inspector',
    replay: 'Stream a session to the UI over WebSocket',
    export: 'Export a session to self-contained JSON',
    import: 'Import a JSON export into the store',
    delete: 'Delete saved sessions permanently',
    'backfill-metadata': 'Recompute session metadata columns',
    doctor: 'Diagnose setup and report issues',
    mcp: 'Expose captures to Claude over MCP',
};

const ROOT_EXAMPLES: string[] = [
    '# Capture a Claude Code session (Zed adapter)',
    'acp-devtools proxy npx -y @zed-industries/claude-code-acp',
    '',
    '# Browse captured sessions in the web inspector',
    'acp-devtools ui',
    '',
    '# List sessions, then print one to the terminal',
    'acp-devtools list',
    'acp-devtools inspect 12',
    '',
    "# Diagnose your setup when nothing's being captured",
    'acp-devtools doctor',
];

// Per-command examples, rendered in the EXAMPLES section of `<cmd> --help`.
// Lines starting with '#' are comments; blank strings add vertical space.
const EXAMPLES: Record<string, string[]> = {
    proxy: [
        '# Wrap the Zed Claude Code adapter and capture every frame',
        'acp-devtools proxy npx -y @zed-industries/claude-code-acp',
        '',
        '# Capture headless, into a specific database',
        'acp-devtools proxy --no-ws --save-to /tmp/run.db node ./my-agent.js',
    ],
    ui: [
        '# Serve the inspector on :3737 and open a browser',
        'acp-devtools ui',
        '',
        '# Pick a port and stay headless',
        'acp-devtools ui --port 4000 --no-open',
    ],
    list: [
        'acp-devtools list',
        '',
        '# Machine-readable JSON',
        'acp-devtools list --json',
    ],
    inspect: [
        'acp-devtools inspect 12',
        '',
        '# Only request/response frames for one method',
        'acp-devtools inspect 12 --method session/prompt --paired',
    ],
    search: ['acp-devtools search session/prompt', 'acp-devtools search rate_limit --in-payload'],
    stats: ['acp-devtools stats 12', 'acp-devtools stats 12 --by-method'],
    diff: ['# Worked yesterday, broke today?', 'acp-devtools diff 41 42'],
    export: [
        'acp-devtools export 12 -o session-12.json',
        '',
        '# Straight to stdout for sharing',
        'acp-devtools export 12 > session-12.json',
    ],
    import: ['acp-devtools import session-12.json'],
    delete: ['acp-devtools delete 12', 'acp-devtools delete 12 13 14'],
    replay: ['acp-devtools replay 12', 'acp-devtools replay --file session-12.json'],
    validate: ['acp-devtools validate 12'],
    'session-info': ['acp-devtools session-info 12'],
    doctor: ['acp-devtools doctor'],
    mcp: ['# Read-only MCP server over stdio (wire into .claude/mcp_servers.json)', 'acp-devtools mcp'],
    'backfill-metadata': [
        'acp-devtools backfill-metadata',
        '',
        '# Recompute a single session',
        'acp-devtools backfill-metadata 12',
    ],
};

const INDENT = '  ';
const GAP = 3;

function heading(s: Styler, title: string): string {
    return s.bold(s.yellow(title.toUpperCase()));
}

function wrapText(text: string, width: number): string[] {
    const limit = Math.max(width, 20);
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        if (line && line.length + 1 + word.length > limit) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// A two-column row (term + description) that wraps the description to the
// terminal width and hangs continuation lines under the description column.
// `coloredTerm` carries ANSI codes; `term` is its plain text, used for padding
// so the maths ignores invisible escapes.
function row(term: string, coloredTerm: string, description: string, termWidth: number, width: number): string {
    const descColumn = INDENT.length + termWidth + GAP;
    const wrapped = wrapText(description, width - descColumn);
    const pad = ' '.repeat(termWidth - term.length + GAP);
    const first = INDENT + coloredTerm + pad + (wrapped[0] ?? '');
    const rest = wrapped.slice(1).map((line) => ' '.repeat(descColumn) + line);
    return [first, ...rest].join('\n');
}

function colorizeUsage(usage: string, s: Styler): string {
    return usage
        .split(' ')
        .map((token) => (/^[[<]/.test(token) ? s.dim(token) : s.green(token)))
        .join(' ');
}

function renderExamples(lines: string[], s: Styler): string[] {
    return lines.map((line) => {
        if (line === '') return '';
        if (line.startsWith('#')) return INDENT + s.dim(line);
        const [head, ...rest] = line.split(' ');
        const tail = rest.length ? ' ' + rest.join(' ') : '';
        return INDENT + s.green(head ?? '') + tail;
    });
}

export function formatRootHelp(cmd: Command, helper: Help, s: Styler, width: number): string {
    const out: string[] = [''];

    out.push(INDENT + s.bold(s.cyan('acp') + s.dim('.devtools')) + '  ' + s.dim(`v${cmd.version()}`));
    out.push(INDENT + s.dim(cmd.description()));
    out.push('');

    out.push(heading(s, 'Usage'));
    out.push(INDENT + s.green('acp-devtools') + ' ' + s.dim('<command> [options]'));
    out.push('');

    const visible = helper.visibleCommands(cmd);
    const byName = new Map(visible.map((c) => [c.name(), c]));
    const named = GROUPS.flatMap((g) => g.commands).filter((n) => byName.has(n));
    const termWidth = Math.max(...named.map((n) => n.length), 0);
    const shown = new Set<string>();

    for (const group of GROUPS) {
        const present = group.commands.filter((n) => byName.has(n));
        if (present.length === 0) continue;
        out.push(heading(s, group.title));
        for (const name of present) {
            shown.add(name);
            const summary = SUMMARIES[name] ?? helper.subcommandDescription(byName.get(name)!);
            out.push(row(name, s.green(name), summary, termWidth, width));
        }
        out.push('');
    }

    const rest = visible.filter((c) => !shown.has(c.name()) && c.name() !== 'help');
    if (rest.length > 0) {
        out.push(heading(s, 'More'));
        for (const c of rest) {
            out.push(row(c.name(), s.green(c.name()), helper.subcommandDescription(c), termWidth, width));
        }
        out.push('');
    }

    const options = helper.visibleOptions(cmd);
    if (options.length > 0) {
        out.push(heading(s, 'Options'));
        const optWidth = Math.max(...options.map((o) => helper.optionTerm(o).length));
        for (const o of options) {
            const term = helper.optionTerm(o);
            out.push(row(term, s.cyan(term), tidyHome(helper.optionDescription(o)), optWidth, width));
        }
        out.push('');
    }

    out.push(heading(s, 'Examples'));
    out.push(...renderExamples(ROOT_EXAMPLES, s));
    out.push('');

    out.push(s.dim('Run ') + s.green('acp-devtools <command> --help') + s.dim(' for details on a command.'));
    out.push('');

    return out.join('\n');
}

export function formatCommandHelp(cmd: Command, helper: Help, s: Styler, width: number): string {
    const out: string[] = [''];

    out.push(heading(s, 'Usage'));
    out.push(INDENT + colorizeUsage(helper.commandUsage(cmd), s));
    out.push('');

    const description = helper.commandDescription(cmd);
    if (description) {
        for (const line of wrapText(description, width - INDENT.length)) {
            out.push(INDENT + line);
        }
        out.push('');
    }

    const args = helper.visibleArguments(cmd);
    if (args.length > 0) {
        out.push(heading(s, 'Arguments'));
        const w = Math.max(...args.map((a) => helper.argumentTerm(a).length));
        for (const a of args) {
            const term = helper.argumentTerm(a);
            out.push(row(term, s.green(term), helper.argumentDescription(a), w, width));
        }
        out.push('');
    }

    const options = helper.visibleOptions(cmd);
    if (options.length > 0) {
        out.push(heading(s, 'Options'));
        const w = Math.max(...options.map((o) => helper.optionTerm(o).length));
        for (const o of options) {
            const term = helper.optionTerm(o);
            out.push(row(term, s.cyan(term), tidyHome(helper.optionDescription(o)), w, width));
        }
        out.push('');
    }

    const examples = EXAMPLES[cmd.name()];
    if (examples && examples.length > 0) {
        out.push(heading(s, 'Examples'));
        out.push(...renderExamples(examples, s));
        out.push('');
    }

    return out.join('\n');
}

export function configureCliHelp(program: Command): void {
    program.configureHelp({
        helpWidth: process.stdout.columns ?? 80,
        formatHelp(cmd, helper) {
            const s = createStyler(colorEnabled(process.stdout));
            const width = process.stdout.columns ?? 80;
            return cmd.parent === null
                ? formatRootHelp(cmd, helper, s, width)
                : formatCommandHelp(cmd, helper, s, width);
        },
    });

    const err = createStyler(colorEnabled(process.stderr));
    program.configureOutput({
        outputError(str, write) {
            write(err.red(str));
        },
    });
}
