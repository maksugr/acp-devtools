#!/usr/bin/env bash
# One-time repository setup for the PR → approve → auto-merge → auto-release
# flow. Needs the GitHub CLI logged in as a repo admin:
#
#   bash scripts/setup-github.sh            # apply
#   bash scripts/setup-github.sh --dry-run  # print what would be sent
#
# What it configures (all idempotent — safe to re-run):
#   - merge settings: squash-only, auto-merge on, delete head branch on merge
#   - labels: `ship` (maintainer approval), `no-release` (merge without publishing),
#     `ci` and `security` (issue/PR categories on top of GitHub's defaults)
#   - a `main` ruleset: changes only via PR, no force-push or deletion, and the
#     required checks `ci-ok`, `release-check`, `ship-gate` (from GitHub
#     Actions only), with the branch up to date before merging
#
# Not covered here (do these by hand once):
#   - npmjs.com → acp-devtools → Settings → Trusted publisher → GitHub Actions:
#     owner `maksugr`, repo `acp-devtools`, workflow `release.yml`
#   - optional: repo secret HOMEBREW_TAP_TOKEN — a fine-grained PAT with
#     Contents: read & write on maksugr/homebrew-tap
set -euo pipefail

REPO="${REPO:-maksugr/acp-devtools}"
RULESET_NAME="main: PRs + required checks"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

run() {
    if $DRY_RUN; then
        printf '+ %s\n' "$*"
    else
        "$@"
    fi
}

echo "→ merge settings"
run gh api -X PATCH "repos/$REPO" \
    -F allow_squash_merge=true \
    -F allow_merge_commit=false \
    -F allow_rebase_merge=false \
    -F allow_auto_merge=true \
    -F delete_branch_on_merge=true \
    -f squash_merge_commit_title=PR_TITLE \
    -f squash_merge_commit_message=COMMIT_MESSAGES \
    --silent

echo "→ labels"
run gh label create ship --repo "$REPO" --force --color 0E8A16 \
    --description "Maintainer approval: merge once all checks are green"
run gh label create no-release --repo "$REPO" --force --color BFD4F2 \
    --description "Merge shipped-file changes without bumping or publishing"
run gh label create ci --repo "$REPO" --force --color 1D76DB \
    --description "CI, build and the release pipeline"
run gh label create security --repo "$REPO" --force --color B60205 \
    --description "Secret redaction, leaks and other security fixes"

echo "→ ruleset for main"
# 15368 is the GitHub Actions app: only checks reported by Actions count.
RULESET=$(cat <<JSON
{
  "name": "$RULESET_NAME",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "ci-ok", "integration_id": 15368 },
          { "context": "release-check", "integration_id": 15368 },
          { "context": "ship-gate", "integration_id": 15368 }
        ]
      }
    }
  ]
}
JSON
)

EXISTING=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" || true)
if $DRY_RUN; then
    echo "+ ${EXISTING:+PUT repos/$REPO/rulesets/$EXISTING}${EXISTING:-POST repos/$REPO/rulesets}"
    echo "$RULESET"
elif [ -n "$EXISTING" ]; then
    echo "$RULESET" | gh api -X PUT "repos/$REPO/rulesets/$EXISTING" --input - --silent
    echo "  updated ruleset #$EXISTING"
else
    echo "$RULESET" | gh api -X POST "repos/$REPO/rulesets" --input - --silent
    echo "  created ruleset"
fi

echo "done."
