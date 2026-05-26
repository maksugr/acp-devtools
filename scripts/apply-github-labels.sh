#!/usr/bin/env bash
# Apply the acp-devtools label set to the current GitHub repo.
# Run once after pushing the repo to github.com. Requires `gh` CLI logged in
# and the repo to exist remotely (`gh repo view` must succeed).
#
# Usage: bash scripts/apply-github-labels.sh
#
# Safe to re-run — uses `gh label create --force` semantics where supported.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
    echo "error: 'gh' CLI not found. Install from https://cli.github.com/" >&2
    exit 1
fi

if ! gh repo view >/dev/null 2>&1; then
    echo "error: 'gh repo view' failed — push the repo to GitHub first." >&2
    exit 1
fi

# Default labels we don't need — remove if they exist. Ignore errors.
for stale in duplicate invalid wontfix; do
    gh label delete "$stale" --yes 2>/dev/null || true
done

# Rename "documentation" → "docs" if it's still the default.
gh label edit "documentation" --name "docs" 2>/dev/null || true

create_or_update_label() {
    local name="$1"
    local color="$2"
    local description="$3"
    if gh label list --limit 200 | awk '{print $1}' | grep -qx "$name"; then
        gh label edit "$name" --color "$color" --description "$description"
    else
        gh label create "$name" --color "$color" --description "$description"
    fi
}

# Core set
create_or_update_label "bug"              "d73a4a" "Something works incorrectly"
create_or_update_label "enhancement"      "a2eeef" "New feature or improvement"
create_or_update_label "docs"             "0075ca" "Documentation / README / examples"
create_or_update_label "good first issue" "7057ff" "Suitable for first-time contributors"
create_or_update_label "help wanted"      "008672" "Maintainer is looking for contributors"
create_or_update_label "question"         "d876e3" "Question or clarification"

# Domain-specific
create_or_update_label "protocol"         "fbca04" "Related to the ACP specification"
create_or_update_label "ui"               "c2e0c6" "UI / frontend / inspector"
create_or_update_label "proxy"            "bfdadc" "Core proxy / capture / parser"
create_or_update_label "storage"          "f9d0c4" "SQLite captures / replay / discovery"
create_or_update_label "build"            "ededed" "CI / tsup / packaging"

echo "labels applied successfully"
