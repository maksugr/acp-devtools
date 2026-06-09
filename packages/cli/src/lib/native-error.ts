/**
 * Detection + actionable error message when `better-sqlite3` (or any other
 * future native dep) fails to load. The CLI cannot run without the SQLite
 * binding — every command transitively imports the storage layer — so a
 * failed `import` here is fatal and surfaces as the very first thing the
 * user sees.
 *
 * Two install paths regress in different ways:
 *
 *   - **`npm i -g`** runs lifecycle scripts by default, so the
 *     `better-sqlite3` postinstall fetches a prebuild for the local Node ABI
 *     (or falls back to building from source). Failure modes here are
 *     "no prebuild for this Node major" + "no C++ toolchain to fall back to".
 *   - **Homebrew** runs `npm install` with `std_npm_args`, which includes
 *     `--ignore-scripts` — the postinstall never runs, so neither the
 *     prebuild fetch nor the source build happens, and `build/Release/
 *     better_sqlite3.node` is simply absent.
 *
 * The remediation differs between the two, so we detect the install path
 * by inspecting `process.argv[1]` (the resolved bin) and tailor the
 * instructions.
 */

const BINDING_PATTERNS = [
    /Could not locate the bindings file/i,
    /better[_-]sqlite3/i,
    /node[_-]gyp/i,
    /prebuild[-_]install/i,
    /\.node['"]?\)?:?\s/i,
    /Cannot find module .*\.node/i,
    /NODE_MODULE_VERSION/i,
];

export function isNativeBindingError(err: unknown): boolean {
    if (!err) return false;
    const msg =
        err instanceof Error
            ? `${err.message}\n${err.stack ?? ''}`
            : String(err);
    return BINDING_PATTERNS.some((re) => re.test(msg));
}

export interface InstallContext {
    /** Resolved binary path. Pass `process.argv[1]`. */
    binaryPath: string;
    /** Override platform detection in tests. */
    platform?: NodeJS.Platform;
}

export type InstallSource = 'homebrew' | 'npm-global' | 'unknown';

export function detectInstallSource(ctx: InstallContext): InstallSource {
    const p = (ctx.binaryPath ?? '').toLowerCase();
    if (!p) return 'unknown';
    // /opt/homebrew/... (Apple silicon) or /usr/local/Cellar/... (Intel mac)
    // or /home/linuxbrew/... — any path containing `/cellar/` after a
    // homebrew prefix is a brew install.
    if (p.includes('/cellar/acp-devtools/') || p.includes('/homebrew/')) {
        return 'homebrew';
    }
    if (p.includes('linuxbrew')) return 'homebrew';
    // npm -g locations: /usr/local/lib/node_modules/acp-devtools/...,
    // ~/.nvm/versions/node/vXX/lib/node_modules/..., %AppData%\npm\...
    if (
        p.includes('/lib/node_modules/acp-devtools') ||
        p.includes('\\node_modules\\acp-devtools') ||
        p.includes('/npm/node_modules/acp-devtools') ||
        p.includes('\\npm\\acp-devtools')
    ) {
        return 'npm-global';
    }
    return 'unknown';
}

export function formatNativeBindingMessage(
    err: unknown,
    ctx: InstallContext,
): string {
    const source = detectInstallSource(ctx);
    const detail =
        err instanceof Error ? err.message : String(err ?? 'unknown error');

    const lines: string[] = [
        'acp-devtools: native module `better-sqlite3` failed to load.',
        '',
        'The SQLite binding (`build/Release/better_sqlite3.node`) is missing or',
        'incompatible with this Node version. acp-devtools needs it to read and',
        'write the captures database — every command depends on it.',
        '',
    ];

    if (source === 'homebrew') {
        lines.push(
            'You installed via Homebrew. Rebuild the binding in place:',
            '',
            '    PREFIX="$(brew --prefix acp-devtools)/libexec/lib/node_modules/acp-devtools"',
            '    npm rebuild --prefix "$PREFIX" better-sqlite3',
            '',
            'Or reinstall once the formula fix lands:',
            '',
            '    brew update && brew reinstall acp-devtools',
            '',
        );
    } else if (source === 'npm-global') {
        lines.push(
            'You installed via `npm i -g`. Rebuild the binding:',
            '',
            '    npm rebuild -g better-sqlite3',
            '',
            'If that fails the prebuild lookup probably has no match for your Node',
            'version, and source build needs Python 3 + a C++ toolchain (Xcode CLT',
            'on macOS, build-essential on Linux, Visual Studio Build Tools on',
            'Windows). Install those and retry, or pin to an older Node major.',
            '',
        );
    } else {
        lines.push(
            'Try rebuilding the native dependency:',
            '',
            '    npm rebuild better-sqlite3',
            '',
            'If you installed globally via npm, add `-g`. If via Homebrew, run',
            '`brew reinstall acp-devtools` once the formula is patched.',
            '',
        );
    }

    lines.push(
        `Underlying error: ${detail}`,
        `Node: ${process.version} · platform: ${process.platform}/${process.arch}`,
        'Report unresolved cases at https://github.com/maksugr/acp-devtools/issues',
    );

    return lines.join('\n') + '\n';
}
