import { Command } from 'commander';
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
import { configureCliHelp } from './lib/help.js';
import { CLI_VERSION } from './version.js';

export function buildProgram(): Command {
    const program = new Command();

    program
        .name('acp-devtools')
        .description('Visual debugger / inspector for the Agent Client Protocol (ACP)')
        .version(CLI_VERSION)
        .enablePositionalOptions();

    // Must run before the register* calls: commander copies the parent's help
    // and output configuration into each subcommand at creation time
    // (copyInheritedSettings), so configuring afterwards would leave every
    // `<command> --help` on commander's default renderer.
    configureCliHelp(program);

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

    return program;
}
