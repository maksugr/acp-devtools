import { describe, expect, it } from 'vitest';
import {
    detectInstallSource,
    formatNativeBindingMessage,
    isNativeBindingError,
} from './native-error.js';

describe('isNativeBindingError', () => {
    it('matches the real better-sqlite3 bindings error', () => {
        const err = new Error(
            'Could not locate the bindings file. Tried:\n' +
                ' → /opt/homebrew/Cellar/acp-devtools/0.2.0/libexec/lib/node_modules/' +
                'acp-devtools/node_modules/better-sqlite3/build/better_sqlite3.node',
        );
        expect(isNativeBindingError(err)).toBe(true);
    });

    it('matches NODE_MODULE_VERSION ABI mismatches', () => {
        expect(
            isNativeBindingError(
                new Error(
                    'The module was compiled against a different Node.js ' +
                        'version using NODE_MODULE_VERSION 115. This version of ' +
                        'Node.js requires NODE_MODULE_VERSION 127.',
                ),
            ),
        ).toBe(true);
    });

    it('matches Cannot find module *.node', () => {
        expect(
            isNativeBindingError(
                new Error(
                    "Cannot find module '.../better_sqlite3.node'",
                ),
            ),
        ).toBe(true);
    });

    it('does not match unrelated errors', () => {
        expect(isNativeBindingError(new Error('ENOENT: no such file'))).toBe(
            false,
        );
        expect(isNativeBindingError(new Error('foo bar'))).toBe(false);
        expect(isNativeBindingError(null)).toBe(false);
        expect(isNativeBindingError(undefined)).toBe(false);
    });
});

describe('detectInstallSource', () => {
    it('detects Homebrew on Apple silicon', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    '/opt/homebrew/Cellar/acp-devtools/0.2.0/libexec/bin/acp-devtools',
            }),
        ).toBe('homebrew');
    });

    it('detects Homebrew on Intel mac', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    '/usr/local/Cellar/acp-devtools/0.2.0/libexec/bin/acp-devtools',
            }),
        ).toBe('homebrew');
    });

    it('detects Linuxbrew', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    '/home/linuxbrew/.linuxbrew/Cellar/acp-devtools/0.2.0/libexec/bin/acp-devtools',
            }),
        ).toBe('homebrew');
    });

    it('detects npm -g on Linux/macOS', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    '/usr/local/lib/node_modules/acp-devtools/dist/index.js',
            }),
        ).toBe('npm-global');
    });

    it('detects npm -g via nvm', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    '/Users/roman/.nvm/versions/node/v22.10.0/lib/node_modules/acp-devtools/dist/index.js',
            }),
        ).toBe('npm-global');
    });

    it('detects npm -g on Windows', () => {
        expect(
            detectInstallSource({
                binaryPath:
                    'C:\\Users\\roman\\AppData\\Roaming\\npm\\node_modules\\acp-devtools\\dist\\index.js',
            }),
        ).toBe('npm-global');
    });

    it('falls back to unknown for `node packages/cli/dist/index.js`', () => {
        expect(
            detectInstallSource({
                binaryPath: '/Users/roman/code/acp-devtools/packages/cli/dist/index.js',
            }),
        ).toBe('unknown');
    });

    it('handles empty argv[1]', () => {
        expect(detectInstallSource({ binaryPath: '' })).toBe('unknown');
    });
});

describe('formatNativeBindingMessage', () => {
    it('includes brew remediation when source is homebrew', () => {
        const msg = formatNativeBindingMessage(new Error('bindings file'), {
            binaryPath:
                '/opt/homebrew/Cellar/acp-devtools/0.2.0/libexec/bin/acp-devtools',
        });
        expect(msg).toContain('brew --prefix acp-devtools');
        expect(msg).toContain('npm rebuild');
        expect(msg).toContain('brew reinstall acp-devtools');
        expect(msg).not.toContain('npm rebuild -g');
    });

    it('includes npm-global remediation when source is npm-global', () => {
        const msg = formatNativeBindingMessage(new Error('bindings file'), {
            binaryPath: '/usr/local/lib/node_modules/acp-devtools/dist/index.js',
        });
        expect(msg).toContain('npm rebuild -g better-sqlite3');
        expect(msg).toContain('Xcode CLT');
        expect(msg).not.toContain('brew');
    });

    it('falls back to generic remediation for unknown source', () => {
        const msg = formatNativeBindingMessage(new Error('bindings file'), {
            binaryPath: '/some/random/path',
        });
        expect(msg).toContain('npm rebuild better-sqlite3');
        expect(msg).toContain('brew reinstall acp-devtools');
    });

    it('includes the underlying error and runtime info', () => {
        const msg = formatNativeBindingMessage(
            new Error('Could not locate the bindings file'),
            { binaryPath: '' },
        );
        expect(msg).toContain('Underlying error: Could not locate the bindings file');
        expect(msg).toContain(`Node: ${process.version}`);
        expect(msg).toContain('platform:');
        expect(msg).toContain('github.com/maksugr/acp-devtools/issues');
    });
});
