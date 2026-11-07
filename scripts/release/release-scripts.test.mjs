// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    JSON_LOCATIONS,
    ROOT,
    TEXT_LOCATIONS,
    changelogSection,
    compareSemver,
    hasEntries,
    incrementSemver,
    isSemver,
} from './version-files.mjs';

const BUMP = join(ROOT, 'scripts/bump-version.mjs');
const CHECK = join(ROOT, 'scripts/check-release.mjs');

describe('semver helpers', () => {
    it('validates and compares', () => {
        expect(isSemver('1.2.3')).toBe(true);
        expect(isSemver('1.2.3-rc.1')).toBe(true);
        expect(isSemver('1.2')).toBe(false);
        expect(compareSemver('0.6.1', '0.6.0')).toBeGreaterThan(0);
        expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
        expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    });

    it('increments', () => {
        expect(incrementSemver('0.6.0', 'patch')).toBe('0.6.1');
        expect(incrementSemver('0.6.3', 'minor')).toBe('0.7.0');
        expect(incrementSemver('0.6.3', 'major')).toBe('1.0.0');
        expect(incrementSemver('1.0.0-rc.1', 'patch')).toBe('1.0.0');
    });
});

describe('changelog helpers', () => {
    const doc = [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '## [0.2.0] — 2026-06-03',
        '',
        '### Fixed',
        '',
        '- a fix',
        '',
        '## [0.1.0]',
        '',
        'Initial.',
        '',
        '[Unreleased]: https://x/compare/v0.2.0...HEAD',
        '',
    ].join('\n');

    it('extracts a section body up to the next heading', () => {
        expect(changelogSection(doc, '0.2.0')).toBe('### Fixed\n\n- a fix');
        expect(changelogSection(doc, 'Unreleased')).toBe('');
        expect(changelogSection(doc, '0.1.0')).toBe('Initial.');
        expect(changelogSection(doc, '9.9.9')).toBeNull();
    });

    it('detects list entries', () => {
        expect(hasEntries('### Fixed\n\n- a fix')).toBe(true);
        expect(hasEntries('### Fixed')).toBe(false);
        expect(hasEntries(null)).toBe(false);
    });
});

/** A scratch git repo holding just the files the release scripts read. */
function scaffold() {
    const dir = mkdtempSync(join(tmpdir(), 'acp-release-'));
    const files = new Set([
        'CHANGELOG.md',
        ...JSON_LOCATIONS.map((l) => l.file),
        ...TEXT_LOCATIONS.map((l) => l.file),
    ]);
    for (const f of files) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        cpSync(join(ROOT, f), join(dir, f));
    }
    // Start every scenario from an empty [Unreleased], whatever the real
    // CHANGELOG currently holds.
    const changelogPath = join(dir, 'CHANGELOG.md');
    writeFileSync(
        changelogPath,
        readFileSync(changelogPath, 'utf8')
            .replace(/\r\n/g, '\n')
            .replace(/^## \[Unreleased\][^\n]*\n[\s\S]*?(?=^## \[)/m, '## [Unreleased]\n\n'),
    );
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    return { dir, git };
}

function run(script, dir, ...args) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ACP_RELEASE_ROOT: dir, GITHUB_STEP_SUMMARY: '' },
    });
}

function addUnreleasedEntry(dir, text = '- **Fixed** a thing.') {
    const p = join(dir, 'CHANGELOG.md');
    const c = readFileSync(p, 'utf8')
        .replace(/\r\n/g, '\n')
        .replace('## [Unreleased]\n', `## [Unreleased]\n\n### Fixed\n\n${text}\n`);
    writeFileSync(p, c);
}

function touchShipped(dir) {
    const p = join(dir, 'packages/cli/src/version.ts');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/\r\n/g, '\n') + '// touched\n');
}

describe('bump-version + check-release', () => {
    let ctx;
    beforeEach(() => {
        ctx = scaffold();
    });
    afterEach(() => {
        rmSync(ctx.dir, { recursive: true, force: true });
    });

    it('the real repo is consistent', () => {
        const r = run(CHECK, ROOT);
        expect(r.stdout).toContain('release check passed');
        expect(r.status).toBe(0);
    });

    it('refuses to bump with an empty [Unreleased]', () => {
        const r = run(BUMP, ctx.dir, 'patch');
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('no entries');
    });

    it('bumps every location and cuts the changelog section', () => {
        addUnreleasedEntry(ctx.dir);
        const r = run(BUMP, ctx.dir, 'patch', '--date', '2026-11-06');
        expect(r.status).toBe(0);

        const from = JSON.parse(
            readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'),
        ).version;
        const to = incrementSemver(from, 'patch');
        expect(r.stdout).toContain(`${from} → ${to}`);

        const changelog = readFileSync(join(ctx.dir, 'CHANGELOG.md'), 'utf8').replace(
            /\r\n/g,
            '\n',
        );
        expect(changelog).toContain(`## [Unreleased]\n\n## [${to}] — 2026-11-06\n\n### Fixed`);
        expect(changelog).toContain(
            `[Unreleased]: https://github.com/maksugr/acp-devtools/compare/v${to}...HEAD`,
        );
        expect(changelog).toContain(
            `[${to}]: https://github.com/maksugr/acp-devtools/compare/v${from}...v${to}`,
        );

        const check = run(CHECK, ctx.dir);
        expect(check.status).toBe(0);
    });

    it('fails when versions disagree', () => {
        const p = join(ctx.dir, 'packages/core/package.json');
        const json = JSON.parse(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
        json.version = '9.9.9';
        writeFileSync(p, JSON.stringify(json, null, 4) + '\n');
        const r = run(CHECK, ctx.dir);
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('packages/core/package.json → version is 9.9.9');
    });

    it('requires a bump when shipped files change', () => {
        touchShipped(ctx.dir);
        ctx.git('commit', '-qam', 'change');
        const r = run(CHECK, ctx.dir, '--base', 'main');
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('shipped files changed but the version is still');
        expect(r.stdout).toContain('packages/cli/src/version.ts');

        const allowed = run(CHECK, ctx.dir, '--base', 'main', '--allow-no-bump');
        expect(allowed.status).toBe(0);
    });

    it('does not require a bump for tests, docs or CI', () => {
        mkdirSync(join(ctx.dir, 'packages/core/src'), { recursive: true });
        writeFileSync(join(ctx.dir, 'packages/core/src/x.test.ts'), '');
        mkdirSync(join(ctx.dir, 'packages/core/src/__golden__'), { recursive: true });
        writeFileSync(join(ctx.dir, 'packages/core/src/__golden__/x.golden.json'), '{}\n');
        writeFileSync(join(ctx.dir, 'README.md'), '# hi\n');
        ctx.git('add', '-A');
        ctx.git('commit', '-qm', 'docs');
        const r = run(CHECK, ctx.dir, '--base', 'main');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('does not release');
    });

    it('passes a correctly bumped PR', () => {
        touchShipped(ctx.dir);
        addUnreleasedEntry(ctx.dir);
        expect(run(BUMP, ctx.dir, 'minor').status).toBe(0);
        ctx.git('commit', '-qam', 'bump');
        const r = run(CHECK, ctx.dir, '--base', 'main');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('releases **');
    });

    it('rejects entries left under [Unreleased] after a bump', () => {
        addUnreleasedEntry(ctx.dir);
        expect(run(BUMP, ctx.dir, 'patch').status).toBe(0);
        addUnreleasedEntry(ctx.dir, '- stranded entry');
        ctx.git('commit', '-qam', 'bump');
        const r = run(CHECK, ctx.dir, '--base', 'main');
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('[Unreleased] still has entries');
    });

    it('rejects a version that goes backwards', () => {
        addUnreleasedEntry(ctx.dir);
        expect(run(BUMP, ctx.dir, 'patch').status).toBe(0);
        ctx.git('commit', '-qam', 'bump');
        ctx.git('checkout', '-q', 'main');
        addUnreleasedEntry(ctx.dir);
        expect(run(BUMP, ctx.dir, 'major').status).toBe(0);
        ctx.git('commit', '-qam', 'major on main');
        ctx.git('checkout', '-q', 'feature');
        const r = run(CHECK, ctx.dir, '--base', 'main');
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('must be greater than base');
    });
});
