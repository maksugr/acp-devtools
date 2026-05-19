#!/usr/bin/env node
import { Command } from 'commander';
import { registerProxyCommand } from './commands/proxy.js';
import { registerReplayCommand } from './commands/replay.js';

const program = new Command();

program
    .name('acp-devtools')
    .description('Visual debugger / inspector for the Agent Client Protocol (ACP)')
    .version('0.1.0')
    .enablePositionalOptions();

registerProxyCommand(program);
registerReplayCommand(program);

program.parseAsync(process.argv).catch((err) => {
    process.stderr.write(`acp-devtools: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
