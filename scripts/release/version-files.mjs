// Every place the release version lives. `bump-version.mjs` rewrites them,
// `check-release.mjs` asserts they agree. Add a new location here once and
// both scripts pick it up.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Overridable so tests can run the scripts against a scratch copy of the repo.
export const ROOT =
    process.env.ACP_RELEASE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The published package — its version is the release version. */
export const PUBLISHED_PACKAGE = 'packages/cli/package.json';
export const PUBLISHED_NAME = 'acp-devtools';
export const CHANGELOG = 'CHANGELOG.md';
export const REPO_URL = 'https://github.com/maksugr/acp-devtools';

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/**
 * Source files that embed the version as a literal. `pattern` must contain
 * exactly one capture group around the version.
 */
export const TEXT_LOCATIONS = [
    {
        file: 'packages/cli/src/version.ts',
        pattern: new RegExp(`CLI_VERSION = '(${SEMVER})'`),
    },
    {
        file: 'packages/ui/src/components/TopBar.tsx',
        pattern: new RegExp(`^\\s*v(${SEMVER})\\s*$`, 'm'),
    },
    {
        file: 'packages/ui/src/components/EmptyState.tsx',
        pattern: new RegExp(`v(${SEMVER}) / pre-alpha`),
    },
    {
        file: 'packages/ui/src/lib/downloadExport.ts',
        pattern: new RegExp(`name: 'acp-devtools-ui', version: '(${SEMVER})'`),
    },
];

/** `package.json` files and the JSON paths inside them that carry the version. */
export const JSON_LOCATIONS = [
    {
        file: 'packages/cli/package.json',
        paths: [['version'], ['devDependencies', '@acp-devtools/core']],
    },
    { file: 'packages/core/package.json', paths: [['version']] },
    {
        file: 'packages/ui/package.json',
        paths: [['version'], ['dependencies', '@acp-devtools/core']],
    },
    {
        file: 'package-lock.json',
        paths: [
            ['packages', 'packages/cli', 'version'],
            ['packages', 'packages/cli', 'devDependencies', '@acp-devtools/core'],
            ['packages', 'packages/core', 'version'],
            ['packages', 'packages/ui', 'version'],
            ['packages', 'packages/ui', 'dependencies', '@acp-devtools/core'],
        ],
    },
];

/** Reads with LF line endings, so Windows checkouts (core.autocrlf) parse the same. */
export function readText(rel) {
    return readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

export function writeText(rel, content) {
    writeFileSync(join(ROOT, rel), content);
}

export function readJson(rel) {
    return JSON.parse(readText(rel));
}

/** Serialize the way the repo formats JSON: 4-space indent, trailing newline. */
export function writeJson(rel, value) {
    writeText(rel, JSON.stringify(value, null, 4) + '\n');
}

export function getPath(obj, path) {
    return path.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function setPath(obj, path, value) {
    const parent = getPath(obj, path.slice(0, -1));
    if (parent == null || !(path[path.length - 1] in parent)) {
        throw new Error(`missing JSON path ${path.join('.')}`);
    }
    parent[path[path.length - 1]] = value;
}

export function currentVersion() {
    return readJson(PUBLISHED_PACKAGE).version;
}

/** Every version occurrence as `{ where, version }` (version is `undefined` if not found). */
export function collectVersions() {
    const out = [];
    for (const { file, paths } of JSON_LOCATIONS) {
        const json = readJson(file);
        for (const path of paths) {
            out.push({ where: `${file} → ${path.join('.')}`, version: getPath(json, path) });
        }
    }
    for (const { file, pattern } of TEXT_LOCATIONS) {
        const m = readText(file).match(pattern);
        out.push({ where: file, version: m?.[1] });
    }
    return out;
}

// ── semver ────────────────────────────────────────────────────────────────

const SEMVER_FULL = new RegExp(`^${SEMVER}$`);

export function isSemver(v) {
    return typeof v === 'string' && SEMVER_FULL.test(v);
}

function parse(v) {
    const [core, pre] = v.split('-', 2);
    const [major, minor, patch] = core.split('.').map(Number);
    return { major, minor, patch, pre: pre ?? null };
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareSemver(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    for (const k of ['major', 'minor', 'patch']) {
        if (pa[k] !== pb[k]) return pa[k] - pb[k];
    }
    if (pa.pre === pb.pre) return 0;
    if (pa.pre === null) return 1;
    if (pb.pre === null) return -1;
    return pa.pre < pb.pre ? -1 : 1;
}

export function incrementSemver(v, kind) {
    const p = parse(v);
    if (kind === 'major') return `${p.major + 1}.0.0`;
    if (kind === 'minor') return `${p.major}.${p.minor + 1}.0`;
    if (kind === 'patch')
        return p.pre ? `${p.major}.${p.minor}.${p.patch}` : `${p.major}.${p.minor}.${p.patch + 1}`;
    throw new Error(`unknown bump kind "${kind}"`);
}

// ── changelog ─────────────────────────────────────────────────────────────

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Body of the `## [<version>]` section (everything up to the next `## ` heading
 * or the link-reference block), or `null` when the heading is absent.
 */
export function changelogSection(changelog, version) {
    const heading = new RegExp(`^## \\[${escapeRe(version)}\\][^\\n]*\\n`, 'm');
    const m = heading.exec(changelog);
    if (!m) return null;
    const rest = changelog.slice(m.index + m[0].length);
    const end = rest.search(/^## |^\[[^\]]+\]: /m);
    return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** True when a section body has at least one list entry. */
export function hasEntries(sectionBody) {
    return /^\s*[-*] \S/m.test(sectionBody ?? '');
}
