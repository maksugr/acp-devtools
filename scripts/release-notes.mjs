#!/usr/bin/env node
// Print the CHANGELOG.md section for a version (default: the current one) —
// the body of the GitHub Release the publish workflow creates.
//
//   node scripts/release-notes.mjs [x.y.z]

import {
    CHANGELOG,
    PUBLISHED_NAME,
    REPO_URL,
    changelogSection,
    currentVersion,
    readText,
} from './release/version-files.mjs';

const version = process.argv[2] ?? currentVersion();
const body = changelogSection(readText(CHANGELOG), version);
if (!body) {
    process.stderr.write(`release-notes: CHANGELOG.md has no entries for ${version}\n`);
    process.exit(1);
}

process.stdout.write(
    `${body}\n\n---\n\n` +
        `\`npm install -g ${PUBLISHED_NAME}@${version}\` · ` +
        `[npm](https://www.npmjs.com/package/${PUBLISHED_NAME}/v/${version}) · ` +
        `[CHANGELOG](${REPO_URL}/blob/v${version}/CHANGELOG.md)\n`,
);
