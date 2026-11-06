#!/usr/bin/env bash
# Install and test the acp-devtools Homebrew formula from a scratch local tap,
# the way a user's `brew install` would, without touching maksugr/homebrew-tap.
#
#   bash scripts/homebrew/test-formula.sh <formula.rb> [<tarball.tgz>]
#
# With a tarball, the formula's `url` and `sha256` are first pointed at that
# file, so CI can test the formula against the code in a PR (or the exact
# bytes a release just published). Without one, the formula is installed as
# written. Runs `brew install` and the formula's `test do` block (which runs
# `acp-devtools doctor`, i.e. loads the native better-sqlite3 binding);
# `brew audit` findings are reported but don't fail the run.
set -euo pipefail

FORMULA=${1:?usage: test-formula.sh <formula.rb> [<tarball.tgz>]}
TARBALL=${2:-}
TAP=acp-devtools-ci/scratch

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 \
    HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_ENV_HINTS=1

cleanup() {
    brew uninstall --force --formula "$TAP/acp-devtools" >/dev/null 2>&1 || true
    brew untap --force "$TAP" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

brew tap-new --no-git "$TAP" >/dev/null
TARGET="$(brew --repository "$TAP")/Formula/acp-devtools.rb"
cp "$FORMULA" "$TARGET"

if [ -n "$TARBALL" ]; then
    ABS="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
    SUM=$(shasum -a 256 "$ABS" | cut -d' ' -f1)
    # `-i.bak` works with both BSD (macOS) and GNU sed.
    sed -i.bak -E "s#^(  url \")[^\"]+(\")#\1file://$ABS\2#; s#^(  sha256 \")[0-9a-f]+(\")#\1$SUM\2#" "$TARGET"
    rm -f "$TARGET.bak"
    grep -q "file://$ABS" "$TARGET"
    grep -q "$SUM" "$TARGET"
fi

echo "::group::formula under test"
cat "$TARGET"
echo "::endgroup::"

brew install --formula "$TAP/acp-devtools"
brew test "$TAP/acp-devtools"

if ! brew audit --strict --formula "$TAP/acp-devtools"; then
    echo "::warning::brew audit reported findings for the acp-devtools formula (not blocking)."
fi
