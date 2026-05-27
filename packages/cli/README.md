# ACP Devtools

> Visual debugger and inspector for the Agent Client Protocol (ACP) — a
> transparent stdio proxy that captures every JSON-RPC frame between your
> editor and your coding agent, plus a live web inspector with replay and
> schema validation.

## Install

```bash
npm install -g acp-devtools
which acp-devtools   # absolute path for IDE configs that need it
```

Or run the UI without installing:

```bash
npx acp-devtools ui
```

## Use it

Open the inspector:

```bash
acp-devtools ui
# → http://127.0.0.1:3737/  (browser auto-opens)
```

Add ACP Devtools to your editor as an agent server. The minimum Zed config
(`~/.config/zed/settings.json`):

```json
{
    "agent_servers": {
        "Claude Code (via ACP Devtools)": {
            "type": "custom",
            "command": "acp-devtools"
        }
    }
}
```

Pick your IDE in the inspector's empty state and copy the pre-filled
snippet (the absolute binary path is auto-resolved).

## Full documentation

Architecture, supported agents (Claude Code, Codex, Goose, OpenCode, custom),
JetBrains setup, Claude Code multi-profile recipes, troubleshooting, and the
full CLI reference — all in the GitHub repo:

**<https://github.com/maksugr/acp-devtools>**

## License

MIT
