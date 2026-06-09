#!/usr/bin/env node
import type * as Core from '@acp-devtools/core';
import type { buildProgram as BuildProgram } from './program.js';
import {
    formatNativeBindingMessage,
    isNativeBindingError,
} from './lib/native-error.js';

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
function expandArgv(
    rawArgs: string[],
    defaultAgent: string,
    isAgentShortcut: (s: string) => boolean,
): string[] {
    if (rawArgs.length === 0) {
        if (!process.stdin.isTTY) {
            return ['proxy', '--agent', defaultAgent];
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

function reportFatal(err: unknown, prefix = 'acp-devtools'): never {
    // `better-sqlite3` defers loading its native addon until the first
    // `new Database()` call — not at module evaluation time — so a
    // missing/incompatible binding surfaces inside any command that
    // opens captures.db, not as an import-time throw. Detect it
    // anywhere a top-level catch fires and swap the raw stack for
    // install-path-aware remediation.
    if (isNativeBindingError(err)) {
        process.stderr.write(
            formatNativeBindingMessage(err, {
                binaryPath: process.argv[1] ?? '',
            }),
        );
        process.exit(1);
    }
    process.stderr.write(
        `${prefix}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
}

async function main(): Promise<void> {
    // Dynamic imports so any failure inside the dependency graph is caught
    // here and turned into a friendly diagnostic instead of an unhandled
    // module-load throw. See lib/native-error.ts.
    let core: typeof Core;
    let buildProgram: typeof BuildProgram;
    try {
        core = await import('@acp-devtools/core');
        ({ buildProgram } = await import('./program.js'));
    } catch (err) {
        reportFatal(err, 'acp-devtools: failed to start');
    }

    const expanded = expandArgv(
        process.argv.slice(2),
        core.DEFAULT_AGENT,
        core.isAgentShortcut,
    );

    const program = buildProgram();
    try {
        await program.parseAsync([
            process.argv[0]!,
            process.argv[1]!,
            ...expanded,
        ]);
    } catch (err) {
        reportFatal(err);
    }
}

main();
