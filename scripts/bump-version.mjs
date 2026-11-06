#!/usr/bin/env node
// Bump the release version everywhere it lives and cut the CHANGELOG section.
//
//   node scripts/bump-version.mjs patch|minor|major|<x.y.z> [--date YYYY-MM-DD] [--allow-empty]
//
// Moves the `## [Unreleased]` entries under a new `## [x.y.z] — <date>`
// heading and updates the compare links at the bottom of CHANGELOG.md.
// Refuses to cut an empty release unless `--allow-empty` is passed, so the
// release notes the publish workflow extracts are never blank.

import {
    CHANGELOG,
    JSON_LOCATIONS,
    REPO_URL,
    TEXT_LOCATIONS,
    changelogSection,
    compareSemver,
    currentVersion,
    hasEntries,
    incrementSemver,
    isSemver,
    readJson,
    readText,
    setPath,
    writeJson,
    writeText,
} from './release/version-files.mjs';

function fail(msg) {
    process.stderr.write(`bump-version: ${msg}\n`);
    process.exit(1);
}

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const dateIdx = args.indexOf('--date');
const date = dateIdx !== -1 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
const allowEmpty = args.includes('--allow-empty');

if (!target)
    fail('usage: bump-version.mjs patch|minor|major|<x.y.z> [--date YYYY-MM-DD] [--allow-empty]');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got "${date}"`);

const from = currentVersion();
const to = ['patch', 'minor', 'major'].includes(target) ? incrementSemver(from, target) : target;
if (!isSemver(to)) fail(`"${to}" is not a semver version`);
if (compareSemver(to, from) <= 0) fail(`new version ${to} must be greater than current ${from}`);

// ── changelog first, so a refusal leaves every other file untouched ─────────
let changelog = readText(CHANGELOG);
if (changelogSection(changelog, to) !== null) fail(`CHANGELOG.md already has a [${to}] section`);
const unreleased = changelogSection(changelog, 'Unreleased');
if (unreleased === null) fail('CHANGELOG.md has no "## [Unreleased]" heading');
if (!hasEntries(unreleased) && !allowEmpty) {
    fail('"## [Unreleased]" has no entries — describe the change first (or pass --allow-empty)');
}

changelog = changelog.replace(
    /^## \[Unreleased\][^\n]*\n/m,
    `## [Unreleased]\n\n## [${to}] — ${date}\n`,
);
changelog = changelog.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO_URL}/compare/v${to}...HEAD\n[${to}]: ${REPO_URL}/compare/v${from}...v${to}`,
);
if (!changelog.includes(`[${to}]: `)) {
    changelog =
        changelog.trimEnd() +
        `\n\n[Unreleased]: ${REPO_URL}/compare/v${to}...HEAD\n[${to}]: ${REPO_URL}/compare/v${from}...v${to}\n`;
}
// Collapse the blank-line runs the heading insert can leave behind.
changelog = changelog.replace(/\n{3,}/g, '\n\n');

// ── version locations ─────────────────────────────────────────────────────
for (const { file, paths } of JSON_LOCATIONS) {
    const json = readJson(file);
    for (const path of paths) setPath(json, path, to);
    writeJson(file, json);
}
for (const { file, pattern } of TEXT_LOCATIONS) {
    const text = readText(file);
    const m = text.match(pattern);
    if (!m) fail(`version literal not found in ${file}`);
    writeText(file, text.replace(pattern, m[0].replace(m[1], to)));
}
writeText(CHANGELOG, changelog);

process.stdout.write(`bumped ${from} → ${to}\n`);
