#!/usr/bin/env node
import { Command } from 'commander';
import { DEFAULT_AGENT, isAgentShortcut } from '@acp-devtools/core';
import { registerBackfillMetadataCommand } from './commands/backfill-metadata.js';
import { registerDeleteCommand } from './commands/delete.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerExportCommand } from './commands/export.js';
import { registerImportCommand } from './commands/import.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerListCommand } from './commands/list.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerMockAgentCommand } from './commands/mock-agent.js';
import { registerMockEditorCommand } from './commands/mock-editor.js';
import { registerProxyCommand } from './commands/proxy.js';
import { registerReplayCommand } from './commands/replay.js';
import { registerSearchCommand } from './commands/search.js';
import { registerSessionInfoCommand } from './commands/session-info.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerUiCommand } from './commands/ui.js';
import { registerValidateCommand } from './commands/validate.js';
import { CLI_VERSION } from './version.js';

const KNOWN_SUBCOMMANDS = new Set([
    'proxy',
    'replay',
    'ui',
    'doctor',
    'export',
    'import',
    'delete',
    'diff',
    'list',
    'inspect',
    'search',
    'session-info',
    'stats',
    'validate',
    'backfill-metadata',
    'mcp',
    'mock-agent',
    'mock-editor',
    'help',
    '-h',
    '--help',
    '-V',
    '--version',
]);

/**
 * Expand bare and shorthand invocations so an IDE can spawn `acp-devtools`
 * with no arguments (or just an agent shortname) and still get a working
 * proxy. The mapping is:
 *
 *   acp-devtools                         (TTY)      → commander shows --help
 *   acp-devtools                         (piped)    → proxy --agent claude-code
 *   acp-devtools claude-code [extra]                → proxy --agent claude-code [extra]
 *   acp-devtools proxy ...                          → unchanged
 *   acp-devtools ui|replay|doctor ...               → unchanged
 *   acp-devtools <unknown> ...                      → proxy <unknown> ...
 *
 * The TTY check is the only piece of "magic": when an IDE spawns the binary
 * it pipes stdio, so `process.stdin.isTTY` is `false`. A human in a shell
 * sees `--help`, as expected.
 */
function expandArgv(rawArgs: string[]): string[] {
    if (rawArgs.length === 0) {
        if (!process.stdin.isTTY) {
            return ['proxy', '--agent', DEFAULT_AGENT];
        }
        return rawArgs;
    }
    const first = rawArgs[0]!;
    if (KNOWN_SUBCOMMANDS.has(first)) {
        return rawArgs;
    }
    if (isAgentShortcut(first)) {
        return ['proxy', '--agent', first, ...rawArgs.slice(1)];
    }
    // Everything else: assume it's a custom agent command (or args) for proxy.
    return ['proxy', ...rawArgs];
}

const expanded = expandArgv(process.argv.slice(2));

const program = new Command();

program
    .name('acp-devtools')
    .description('Visual debugger / inspector for the Agent Client Protocol (ACP)')
    .version(CLI_VERSION)
    .enablePositionalOptions();

registerProxyCommand(program);
registerReplayCommand(program);
registerUiCommand(program);
registerDoctorCommand(program);
registerExportCommand(program);
registerImportCommand(program);
registerDeleteCommand(program);
registerDiffCommand(program);
registerListCommand(program);
registerInspectCommand(program);
registerSearchCommand(program);
registerSessionInfoCommand(program);
registerStatsCommand(program);
registerBackfillMetadataCommand(program);
registerMcpCommand(program);
registerMockAgentCommand(program);
registerMockEditorCommand(program);
registerValidateCommand(program);

program.parseAsync([process.argv[0]!, process.argv[1]!, ...expanded]).catch((err) => {
    process.stderr.write(`acp-devtools: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
