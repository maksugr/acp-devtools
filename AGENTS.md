# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, …) working in this
repository. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) has the same ground
rules in long form.

acp-devtools is a transparent stdio proxy, web inspector, CLI and read-only
MCP server for the [Agent Client Protocol](https://agentclientprotocol.com)
(always "Agent Client Protocol" in prose — "ACP" alone collides with other
protocols). It captures every JSON-RPC frame between an editor and an agent,
stores sessions in SQLite, and validates frames against the official schema.

## Ground rules

- **Never commit or push to `main`.** Every change goes through a pull request;
  the `main` ruleset enforces this.
- **Don't commit, push or open a PR unless the maintainer asked for it** in the
  current conversation. Don't merge PRs, and don't add the `ship` label — that
  label _is_ the maintainer's approval.
- **Commits carry a human author.** Author: the maintainer,
  `Roman Ponomarev <maksugr@gmail.com>`. The agent is credited with a
  `Co-Authored-By:` trailer, never as the sole author.
- One concern per PR. Never skip, disable or weaken a test to get CI green.
- Ship a test with every behaviour change (colocated `*.test.ts`).
- Golden snapshots (`__golden__/`) record what the tools report for every
  fixture. Update them with `-u` only for an intended change and say in the PR
  what moved; an unexpected diff is a regression
  ([CONTRIBUTING.md § Golden tests](CONTRIBUTING.md#golden-tests)).

## Commands

```bash
npm ci                 # install (Node ≥ 22; better-sqlite3 is a native addon)
npm run precommit      # lint + format check + typecheck + all tests — run before every commit
npm run format         # Prettier over the whole repo; CI fails on unformatted files
npm test               # vitest, ~70 s (CLI integration tests dominate)
npx vitest run <path>  # a single file or directory
npm run build:full     # core + CLI bundle + UI, embedded into packages/cli/dist
npm run release:check  # version consistency (CI runs this too)
```

## Layout

- `packages/core` — proxy (`proxy/`), JSON-RPC framing + ACP analysis
  (`acp/`: parser, validator, metadata, stats, diff), SQLite storage and
  redaction (`storage/`), HTTP/WS servers. Private; bundled into the CLI.
- `packages/cli` — the published `acp-devtools` package (commander; one file
  per command in `src/commands/`, MCP server in `src/commands/mcp.ts`).
- `packages/ui` — React + Vite inspector, embedded into the CLI's `dist/ui` and
  also deployed as the static playground. Imports only browser-safe core
  subpaths (`@acp-devtools/core/acp/...`, `.../storage/redact`).
- `fixtures/` — generators, mock agent, verified agent captures
  (`fixtures/handshakes/`). `scripts/` — release tooling, demo recorder.

## Releasing — every PR that ships code bumps the version

Merging to `main` publishes automatically (`.github/workflows/release.yml`), so
the PR itself carries the release:

1. Describe the change under `## [Unreleased]` in `CHANGELOG.md`
   (Keep a Changelog sections: Added / Changed / Fixed / Security / …).
2. `npm run release:bump -- patch|minor|major` — moves the entries under a new
   version heading and rewrites every version literal
   (`scripts/release/version-files.mjs` lists them; add new ones there).
3. Update `README.md` / `docs/` when user-visible behaviour changes.

`release-check` fails a PR that changes anything under `packages/` (tests
excepted) without a bump, bumps backwards, or leaves entries in
`[Unreleased]`. Docs/CI-only PRs need no bump. The `no-release` label (maintainer
only) merges shipped-file changes without publishing.

Merge flow: PR → CI (`ci-ok`, `release-check`) → maintainer adds `ship`
(`ship-gate`) → GitHub auto-merges (squash) → Release publishes to npm, tags,
creates the GitHub Release, bumps the Homebrew tap once the new formula passes
`brew install`, `brew test` and `brew audit --strict` on macOS. New commits that change the
diff revoke `ship`.

## Issues

Follow-ups that won't fit the current PR go into a GitHub issue — the
conversation that found them doesn't survive the session.

- Search open issues first; extend one rather than filing a duplicate.
- **Labels:** only ones that already exist — GitHub's defaults (`bug`,
  `enhancement`, `documentation`, …) plus `ci` and `security` (defined in
  `scripts/setup-github.sh`). If nothing fits, propose a new label to the
  maintainer instead of creating one. `ship` and `no-release` are PR-only and
  maintainer-only.
- **Assignee:** the maintainer (`maksugr`).
- **Body:** _Problem_ with evidence (failing run, PR, exact error), _Proposal_,
  and a _Done when_ checklist that can be ticked off from CI or the release.
- Link related issues and PRs by full URL; the PR that resolves an issue says
  `Closes #N`.

## Security rules (constraints, not suggestions)

Captures hold real secrets (JetBrains `proxy_key`, MCP server headers/env, …).
`packages/core/src/storage/redact.ts` is the single source of truth for what is
masked. `export --raw` is the only un-redacted export path; MCP tools always
redact; `search_messages` matches raw bytes but returns redacted frames. Full
rules: [CONTRIBUTING.md § Security design rules](CONTRIBUTING.md#security-design-rules).

## Conventions and gotchas

- Run `npm run format` before committing — CI runs `format:check` on every
  file. Never reformat by hand or exclude files to get it green.
- 4-space indent, Prettier (`printWidth` 100), ESM with explicit `.js` import
  extensions, `import type` for types. Comments explain _why_, not _what_.
- JSON-RPC ids are scoped per sender: an editor request and an agent request
  can share an id. Correlate by `(direction, id)`, never by id alone.
- The ACP schema comes from `@agentclientprotocol/sdk` (`validate*.ts`,
  `spec-decoder*.ts` — a Node and a browser entry each). SDK ≥ 2 moved it to
  versioned paths (`schema/v1/…`, `schema/v2/…`).
- Tests run with `TZ=UTC` under jsdom; CI covers Linux, macOS and Windows ×
  Node 22/24, so avoid POSIX-only paths and shell assumptions in tests.
