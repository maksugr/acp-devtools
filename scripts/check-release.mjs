#!/usr/bin/env node
// Release-readiness gate.
//
//   node scripts/check-release.mjs                       # consistency only
//   node scripts/check-release.mjs --base origin/main    # + "did this PR bump correctly?"
//   node scripts/check-release.mjs --base origin/main --registry
//
// Always: every version location agrees, and CHANGELOG.md has a section for
// the current version plus an `[Unreleased]` heading.
//
// With --base <ref>:
//   - a PR that touches shipped files (anything under packages/ except tests and their golden snapshots)
//     must bump the version, unless --allow-no-bump (the `no-release` label);
//   - a bumped version must be strictly greater than the base, have a
//     CHANGELOG section with entries, and leave `[Unreleased]` empty (entries
//     left there would never reach the release notes).
//
// With --registry: a bumped version must not already exist on npm or as a
// git tag on origin.
//
// Exits 1 on any failure; prints a summary (also to $GITHUB_STEP_SUMMARY).

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
    CHANGELOG,
    PUBLISHED_NAME,
    PUBLISHED_PACKAGE,
    ROOT,
    changelogSection,
    collectVersions,
    compareSemver,
    currentVersion,
    hasEntries,
    isSemver,
    readText,
} from './release/version-files.mjs';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const base = baseIdx !== -1 ? args[baseIdx + 1] : null;
const checkRegistry = args.includes('--registry');
const allowNoBump = args.includes('--allow-no-bump');

const errors = [];
const notes = [];

function git(...a) {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Files under packages/ that end up in (or define) the published artifact. */
function isShipped(file) {
    if (!file.startsWith('packages/')) return false;
    if (/\.test\.(ts|tsx|js|mjs)$/.test(file)) return false;
    // Golden snapshots belong to the tests next to them.
    if (file.includes('/__golden__/')) return false;
    return true;
}

// ── 1. consistency ────────────────────────────────────────────────────────
const version = currentVersion();
if (!isSemver(version)) errors.push(`${PUBLISHED_PACKAGE} version "${version}" is not semver`);

for (const { where, version: v } of collectVersions()) {
    if (v === undefined) errors.push(`version not found in ${where}`);
    else if (v !== version) errors.push(`${where} is ${v}, expected ${version}`);
}

const changelog = readText(CHANGELOG);
const section = changelogSection(changelog, version);
const unreleased = changelogSection(changelog, 'Unreleased');
if (section === null) errors.push(`CHANGELOG.md has no "## [${version}]" section`);
if (unreleased === null) errors.push('CHANGELOG.md has no "## [Unreleased]" heading');

// ── 2. bump rules vs base ─────────────────────────────────────────────────
let bumped = false;
if (base) {
    const baseVersion = JSON.parse(git('show', `${base}:${PUBLISHED_PACKAGE}`)).version;
    const mergeBase = git('merge-base', base, 'HEAD');
    const changed = git('diff', '--name-only', mergeBase, 'HEAD').split('\n').filter(Boolean);
    const shipped = changed.filter(isShipped);
    bumped = version !== baseVersion;

    notes.push(`base ${base} is at ${baseVersion}, this branch is at ${version}`);
    notes.push(`${changed.length} file(s) changed, ${shipped.length} of them shipped`);

    if (bumped) {
        if (compareSemver(version, baseVersion) <= 0) {
            errors.push(`version ${version} must be greater than base ${baseVersion}`);
        }
        if (section !== null && !hasEntries(section)) {
            errors.push(`CHANGELOG.md section [${version}] has no entries`);
        }
        if (hasEntries(unreleased)) {
            errors.push(
                `CHANGELOG.md [Unreleased] still has entries — move them under [${version}] (npm run release:bump does this)`,
            );
        }
    } else if (shipped.length > 0) {
        if (allowNoBump) {
            notes.push('shipped files changed without a bump — allowed by the `no-release` label');
        } else {
            errors.push(
                `shipped files changed but the version is still ${version}. ` +
                    'Add entries under [Unreleased] and run `npm run release:bump -- patch|minor|major`, ' +
                    'or add the `no-release` label if this must not publish.\n' +
                    shipped.map((f) => `      ${f}`).join('\n'),
            );
        }
    }
}

// ── 3. registry ───────────────────────────────────────────────────────────
if (checkRegistry && (bumped || !base)) {
    let onNpm = false;
    try {
        onNpm =
            execFileSync('npm', ['view', `${PUBLISHED_NAME}@${version}`, 'version'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: process.platform === 'win32',
            }).trim() === version;
    } catch {
        onNpm = false; // E404 → not published
    }
    const tag = git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`);
    if (base) {
        if (onNpm) errors.push(`${PUBLISHED_NAME}@${version} is already on npm`);
        if (tag) errors.push(`tag v${version} already exists on origin`);
    } else {
        notes.push(
            `npm: ${onNpm ? 'published' : 'not published'} · tag: ${tag ? 'exists' : 'absent'}`,
        );
    }
}

// ── report ────────────────────────────────────────────────────────────────
const verdict = errors.length === 0 ? '✅ release check passed' : '❌ release check failed';
const release = base
    ? bumped
        ? `this PR releases **${version}** on merge`
        : 'this PR does not release (version unchanged)'
    : `version ${version}`;

const lines = [
    verdict,
    `- ${release}`,
    ...notes.map((n) => `- ${n}`),
    ...errors.map((e) => `- ✗ ${e}`),
];
process.stdout.write(lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### ${lines[0]}\n\n${lines.slice(1).join('\n')}\n`,
    );
}
process.exit(errors.length === 0 ? 0 : 1);
