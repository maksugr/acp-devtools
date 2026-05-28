import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
    acpHomeDir,
    defaultCapturesDbPath,
    listActive,
    openDatabase,
} from '@acp-devtools/core';
import { type Styler, colorEnabled, createStyler } from '../lib/style.js';

type Status = 'ok' | 'warn' | 'fail' | 'info';

interface CheckResult {
    status: Status;
    label: string;
    detail?: string;
}

interface DoctorSection {
    title: string;
    results: CheckResult[];
}

const STATUS_MARK: Record<Status, string> = {
    ok: '✓',
    warn: '!',
    fail: '✗',
    info: '·',
};

function colorStatus(s: Styler, status: Status, text: string): string {
    switch (status) {
        case 'ok':
            return s.green(text);
        case 'warn':
            return s.yellow(text);
        case 'fail':
            return s.red(text);
        default:
            return s.dim(text);
    }
}

function checkEnvironment(): CheckResult[] {
    const results: CheckResult[] = [];
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    results.push({
        status: nodeMajor >= 20 ? 'ok' : 'fail',
        label: `Node ${process.version}`,
        detail: nodeMajor >= 20 ? undefined : 'requires Node 20 or newer',
    });
    results.push({
        status: 'info',
        label: `Platform: ${platform()} ${process.arch} (${release()})`,
    });
    const binary = process.argv[1] ?? '(unknown)';
    results.push({
        status: 'info',
        label: `Binary: ${binary}`,
        detail: 'use this exact path for IDE configs that require absolute paths',
    });
    return results;
}

function checkState(): CheckResult[] {
    const results: CheckResult[] = [];
    const home = acpHomeDir();
    if (!existsSync(home)) {
        results.push({
            status: 'warn',
            label: `${home} not created yet`,
            detail: 'will be created on first proxy run',
        });
        return results;
    }
    results.push({ status: 'ok', label: `${home}/ exists` });

    const dbPath = defaultCapturesDbPath();
    if (existsSync(dbPath)) {
        try {
            const db = openDatabase(dbPath);
            const row = db
                .prepare(
                    `SELECT COUNT(*) AS sessions, COALESCE(SUM(m.cnt), 0) AS messages
                     FROM sessions s
                     LEFT JOIN (
                         SELECT session_id, COUNT(*) AS cnt FROM messages GROUP BY session_id
                     ) m ON m.session_id = s.id`,
                )
                .get() as { sessions: number; messages: number };
            db.close();
            const size = statSync(dbPath).size;
            results.push({
                status: 'ok',
                label: `captures database: ${row.sessions} session${row.sessions === 1 ? '' : 's'}, ${row.messages} message${row.messages === 1 ? '' : 's'}`,
                detail: `${formatBytes(size)} at ${dbPath}`,
            });
        } catch (err) {
            results.push({
                status: 'fail',
                label: `captures database unreadable`,
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    } else {
        results.push({
            status: 'info',
            label: 'captures database not created yet',
            detail: 'first `acp-devtools proxy` run will create it',
        });
    }

    try {
        const active = listActive();
        if (active.length === 0) {
            results.push({
                status: 'info',
                label: 'no live captures right now',
                detail: 'expected if no IDE chat is currently active',
            });
        } else {
            results.push({
                status: 'ok',
                label: `${active.length} live capture${active.length === 1 ? '' : 's'}`,
            });
            for (const cap of active) {
                results.push({
                    status: 'info',
                    label: `  pid ${cap.pid} · ${cap.url} · ${cap.agentCommand}`,
                });
            }
        }
    } catch (err) {
        results.push({
            status: 'fail',
            label: 'cannot read discovery directory',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
    return results;
}

interface IdeProbe {
    name: string;
    path: string;
    exists: boolean;
}

function probeZed(): IdeProbe {
    const path =
        platform() === 'win32'
            ? join(process.env.APPDATA ?? '', 'Zed', 'settings.json')
            : platform() === 'darwin'
              ? join(homedir(), '.config', 'zed', 'settings.json')
              : join(
                    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
                    'zed',
                    'settings.json',
                );
    return { name: 'Zed', path, exists: existsSync(path) };
}

// Matches versioned IDE config dirs like `WebStorm2026.1`, `IntelliJIdea2024.2.1`.
const JETBRAINS_VERSIONED = /^[A-Z][A-Za-z]+\d{4}\.\d/;
// Unversioned JetBrains products that ship in the same root.
const JETBRAINS_UNVERSIONED = new Set(['Fleet', 'Toolbox']);

function probeJetBrains(): IdeProbe[] {
    const baseDirs: string[] = [];
    if (platform() === 'darwin') {
        baseDirs.push(join(homedir(), 'Library', 'Application Support', 'JetBrains'));
    } else if (platform() === 'win32') {
        baseDirs.push(join(process.env.APPDATA ?? '', 'JetBrains'));
    } else {
        baseDirs.push(join(homedir(), '.config', 'JetBrains'));
    }
    const probes: IdeProbe[] = [];
    for (const base of baseDirs) {
        if (!existsSync(base)) continue;
        let entries: string[] = [];
        try {
            entries = readdirSync(base);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            if (!JETBRAINS_VERSIONED.test(entry) && !JETBRAINS_UNVERSIONED.has(entry)) continue;
            const full = join(base, entry);
            try {
                if (!statSync(full).isDirectory()) continue;
            } catch {
                continue;
            }
            probes.push({ name: entry, path: full, exists: true });
        }
    }
    probes.sort((a, b) => a.name.localeCompare(b.name));
    return probes;
}

function checkIdeConfigs(): CheckResult[] {
    const results: CheckResult[] = [];
    const zed = probeZed();
    if (zed.exists) {
        results.push({
            status: 'ok',
            label: `Zed config detected`,
            detail: zed.path,
        });
    } else {
        results.push({
            status: 'info',
            label: 'Zed not detected',
            detail: `expected at ${zed.path}`,
        });
    }
    const jb = probeJetBrains();
    if (jb.length === 0) {
        results.push({ status: 'info', label: 'no JetBrains IDEs detected' });
    } else {
        results.push({
            status: 'ok',
            label: `${jb.length} JetBrains profile${jb.length === 1 ? '' : 's'} detected`,
        });
        for (const probe of jb) {
            results.push({ status: 'info', label: `  ${probe.name}`, detail: probe.path });
        }
    }
    return results;
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function printSections(sections: DoctorSection[], s: Styler): void {
    for (const section of sections) {
        process.stdout.write(`\n${s.bold(s.yellow(section.title))}\n`);
        for (const r of section.results) {
            const mark = colorStatus(s, r.status, STATUS_MARK[r.status]);
            process.stdout.write(`  ${mark} ${r.label}\n`);
            if (r.detail) {
                process.stdout.write(`      ${s.dim(r.detail)}\n`);
            }
        }
    }
    process.stdout.write('\n');
}

function exitCodeFromSections(sections: DoctorSection[]): number {
    for (const s of sections) {
        for (const r of s.results) {
            if (r.status === 'fail') return 1;
        }
    }
    return 0;
}

export function registerDoctorCommand(program: Command): void {
    program
        .command('doctor')
        .description('Diagnose acp-devtools setup and report any issues')
        .option('--json', 'output machine-readable JSON instead of human text')
        .option('--no-color', 'disable ANSI colour output')
        .action((opts: { json?: boolean; color: boolean }) => {
            const sections: DoctorSection[] = [
                { title: 'Environment', results: checkEnvironment() },
                { title: 'State', results: checkState() },
                { title: 'IDE configs (best-effort detection)', results: checkIdeConfigs() },
            ];
            if (opts.json) {
                process.stdout.write(JSON.stringify(sections, null, 2) + '\n');
            } else {
                const s = createStyler(opts.color && colorEnabled(process.stdout));
                printSections(sections, s);
                process.stdout.write(
                    s.dim('Tip: run `acp-devtools ui` to open the inspector, or see\n') +
                        s.dim(
                            '`examples/zed-config.md` and `examples/jetbrains-config.md` for IDE setup.',
                        ) +
                        '\n\n',
                );
            }
            process.exit(exitCodeFromSections(sections));
        });
}
