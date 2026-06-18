import type { Command } from 'commander';
import { listAgents } from '@acp-devtools/core';
import { colorEnabled, createStyler } from '../lib/style.js';
import { type Column, renderTable } from '../lib/table.js';

const COLUMNS: Column[] = [
    { title: 'SHORTCUT' },
    { title: 'NAME' },
    { title: 'RUNS' },
    { title: 'INSTALL' },
];

export function registerAgentsCommand(program: Command): void {
    program
        .command('agents')
        .description('List the built-in agent shortcuts (use with proxy / setup / --agent)')
        .option('--json', 'emit machine-readable JSON instead of a table')
        .action((opts: { json?: boolean }) => {
            const agents = listAgents();
            if (opts.json) {
                process.stdout.write(JSON.stringify(agents, null, 2) + '\n');
                return;
            }
            const s = createStyler(colorEnabled(process.stdout));
            const rows = agents.map((a) => [
                s.green(a.shortName),
                a.displayName,
                [a.command, ...a.args].join(' '),
                a.requiresExternalInstall ? 'install separately' : 'auto via npx',
            ]);
            process.stdout.write(renderTable(s, COLUMNS, rows));
            process.stdout.write(
                s.dim(
                    '\nUse a shortcut: acp-devtools <name> · proxy --agent <name> · ' +
                        'setup <name> --editor <zed|jetbrains>\n' +
                        'Any other ACP agent: acp-devtools setup --editor <ed> -- <command…>\n',
                ),
            );
        });
}
