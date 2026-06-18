import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';
import {
    EDITORS,
    type SetupPlan,
    buildSetupPlan,
    editorInfo,
    isEditor,
    mergeIntoConfig,
    renderConfigBlock,
} from '../lib/setup-config.js';

interface SetupOptions {
    editor?: string;
    name?: string;
    configPath?: string;
    write?: boolean;
    color: boolean;
}

function fail(message: string, code: number): never {
    process.stderr.write(`acp-devtools: ${message}\n`);
    process.exit(code);
}

/** Reconstruct the command a user would re-run, options before the target. */
function rerunCommand(editor: string, target: string[], opts: SetupOptions): string {
    const parts = ['acp-devtools setup', `--editor ${editor}`, '--write'];
    if (opts.name) parts.push(`--name ${JSON.stringify(opts.name)}`);
    if (opts.configPath) parts.push(`--config-path ${opts.configPath}`);
    if (target.length === 1) {
        parts.push(target[0]!);
    } else if (target.length > 1) {
        parts.push('--', ...target);
    }
    return parts.join(' ');
}

function printInstallHint(plan: SetupPlan, s: Styler): void {
    if (plan.isCustom) return;
    if (plan.requiresExternalInstall) {
        process.stdout.write(`\n  ${s.yellow('!')} ${plan.agentDescription}\n`);
    } else {
        process.stdout.write(`\n  ${s.dim('Installs automatically via npx on first run.')}\n`);
    }
}

function printGuidance(
    plan: SetupPlan,
    target: string[],
    opts: SetupOptions,
    configPath: string,
    s: Styler,
): void {
    const block = renderConfigBlock(plan);
    process.stdout.write(
        `\n${s.bold(plan.displayName)} ${s.dim('→')} ${s.bold(plan.editor.label)}\n\n`,
    );
    process.stdout.write(`  ${plan.editor.placement}:\n`);
    process.stdout.write(`  ${s.cyan(configPath)}\n\n`);
    process.stdout.write(`${block}\n`);
    printInstallHint(plan, s);
    process.stdout.write(`\n  Then ${plan.editor.restart}.\n`);
    process.stdout.write(
        `\n  ${s.dim('Or let ACP Devtools edit the file for you:')}\n` +
            `    ${rerunCommand(opts.editor!, target, opts)}\n\n`,
    );
}

function doWrite(
    plan: SetupPlan,
    target: string[],
    opts: SetupOptions,
    configPath: string,
    s: Styler,
): never {
    let existing: string | null = null;
    try {
        existing = readFileSync(configPath, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            fail(`cannot read ${configPath}: ${(err as Error).message}`, 1);
        }
    }

    let merged: { text: string; replaced: boolean };
    try {
        merged = mergeIntoConfig(existing, plan.displayName, plan.entry);
    } catch {
        // A real JSON syntax error (not comments — those are fine). Never
        // clobber the file; print the block to paste by hand instead.
        process.stderr.write(
            `${s.red('✗')} ${configPath} isn't valid JSON — leaving it untouched.\n` +
                `  Paste this block in by hand:\n`,
        );
        process.stdout.write(`\n${renderConfigBlock(plan)}\n\n`);
        process.exit(1);
    }

    try {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, merged.text);
    } catch (err) {
        fail(`cannot write ${configPath}: ${(err as Error).message}`, 1);
    }

    const verb = merged.replaced ? 'updated' : 'wrote';
    process.stdout.write(
        `\n${s.green('✓')} ${verb} ${s.bold(JSON.stringify(plan.displayName))} in ${s.cyan(configPath)}\n`,
    );
    printInstallHint(plan, s);
    process.stdout.write(`\n  Then ${plan.editor.restart}.\n\n`);
    process.exit(0);
}

export function registerSetupCommand(program: Command): void {
    program
        .command('setup [target...]')
        .description('Generate an editor config that runs an agent through ACP Devtools')
        .option('--editor <name>', `target editor (${EDITORS.join(' | ')})`)
        .option('--name <label>', 'display name for the agent entry')
        .option('--config-path <path>', 'override the editor config file location')
        .option('--write', 'merge the entry into the editor config instead of printing it', false)
        .option('--no-color', 'disable ANSI colour output')
        .action((target: string[], opts: SetupOptions) => {
            if (!opts.editor) {
                fail(`--editor is required (${EDITORS.join(' | ')})`, 2);
            }
            if (!isEditor(opts.editor)) {
                fail(`unknown editor "${opts.editor}" (expected ${EDITORS.join(' | ')})`, 2);
            }

            const selfPath = process.argv[1] ?? 'acp-devtools';
            const plan = buildSetupPlan({
                target,
                editor: opts.editor,
                selfPath,
                name: opts.name,
            });
            const configPath = opts.configPath ?? editorInfo(opts.editor).configPath;
            const s = createStyler(opts.color && colorEnabled(process.stdout));

            if (opts.write) {
                doWrite(plan, target, opts, configPath, s);
            }
            printGuidance(plan, target, opts, configPath, s);
            process.exit(0);
        });
}
