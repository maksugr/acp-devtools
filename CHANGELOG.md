# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-03

### Added

- **`acp-devtools export <id> --raw`** flag to opt out of the new default
  redaction (use only when the export stays on your machine).
- **Static playground** — same React inspector, built with
  `VITE_PLAYGROUND=1`, served as a static page so bug reporters can attach a
  `session.json` to an issue and reviewers can drop it into a browser without
  installing anything. File-drop entry + `?url=` loader (host allowlist:
  `raw.githubusercontent.com`, `gist.githubusercontent.com`).
- **GitHub Pages deploy workflow** (`.github/workflows/deploy-playground.yml`)
  that publishes the playground on every push to `main`.
- **README "Security & privacy" section** — threat model, what export
  redacts, what it doesn't (file contents, prompts), sharing flow, design
  rules, security disclosure email.
- **CONTRIBUTING "Security design rules" section** — three immutable rules
  for any contributor touching export / MCP / share channels.
- **`docs/mcp.md` "Redaction" section** — per-tool table of what gets masked
  in every MCP response.
- **`packages/core/src/storage/redact.ts`** — `redactMessage(msg)` and
  `redactSessionExport(exp)` helpers; the single source of truth for
  sensitive-field rules. Subpath export `@acp-devtools/core/storage/redact`
  for browser-safe consumers.
- **`packages/ui/src/lib/playgroundLoad.ts`** — `parseExportSource`,
  `isAllowedPlaygroundUrl`, `fetchPlaygroundExport` helpers.
- **`packages/ui/src/lib/playgroundMode.ts`** — runtime detection of
  playground mode (reads `import.meta.env.VITE_PLAYGROUND`).
- **`packages/ui/src/components/PlaygroundEntry.tsx`** — drop-zone + URL
  input + initialUrl boot.
- **`packages/ui/src/store/messagesStore.ts → loadFromExport`** — one-shot
  replacement of session + messages from a `SessionExport`.

### Changed

- **`acp-devtools export`** redacts auth headers and proxy tokens by default.
  A summary lands on stderr: `redacted N field(s) across M message(s) —
  re-run with --raw to keep them`. Both the parsed `payload` and the
  re-serialized `raw` are rewritten, so the secret can't leak via either
  field.
- **UI "Download as JSON"** likewise redacts unconditionally (the UI has no
  `--raw` toggle by design — see the README's design rules).
- **MCP tools that return frame contents or derived views** redact every
  response: `get_message`, `get_session_messages`, `search_messages`,
  `get_session_metadata`, `get_session_summary`, `diff_sessions`. The
  `instructions` block on `initialize` documents this so connecting LLMs
  know not to expect raw tokens.
- **`search_messages`** matches the pre-redaction bytes (so a token-fragment
  query still finds its frame) but returns the redacted `raw` so the LLM
  can't quote the live secret.
- **`diff_sessions`** operates on already-redacted frames — a rotated token
  between two sessions surfaces as equal (`<REDACTED>` on both sides)
  rather than as a value change. Intentional: "token rotated" would
  otherwise be a side channel.
- **UI export tooltip** explains the redaction and points to
  `acp-devtools export <id> --raw` for an un-redacted CLI alternative.
- **`packages/ui/vite.config.ts`** — skips the dev-only `discoveryPlugin`
  and applies `base: '/acp-devtools/'` when `VITE_PLAYGROUND=1`; both
  configurable via env (`VITE_BASE`).
- **`packages/ui/src/App.tsx`** — discovery polling and WebSocket connect
  are gated on `!isPlaygroundMode()`; the empty state swaps to
  `PlaygroundEntry` when the bundle is in playground mode.

### Security

- JetBrains `proxy_key` (and other auth-bearing headers) no longer leak
  through CLI export, UI download, or MCP tools — see the new README
  "Security & privacy" section for the threat model and what stays
  un-redacted (file contents, prompts).
- Three design rules locked in code + docs to prevent regressions: a single
  `--raw` opt-out (CLI only), no MCP opt-out, `search_messages` returns
  the redacted copy.
- `~/.acp-devtools/captures.db` is now created at `0o600` (owner-only
  read/write) on POSIX systems — previously inherited the user's default
  umask (typically `0o644`), which let any local user account read every
  captured `proxy_key`. WAL sidecar files (`-wal` / `-shm`) tightened
  alongside. Existing databases get the new mode on next open. Windows
  unaffected (NTFS uses ACLs, not POSIX modes).

## [0.1.0]

Initial release. Proxy with live UI, SQLite storage, ACP spec validation,
performance dashboard, multi-session diff, mock-agent / mock-editor for CI,
read-only MCP server, JSON export / import. See `packages/cli/README.md` and
the root `README.md` for the full feature inventory.

[Unreleased]: https://github.com/maksugr/acp-devtools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/maksugr/acp-devtools/releases/tag/v0.2.0
[0.1.0]: https://github.com/maksugr/acp-devtools/releases/tag/v0.1.0
