/**
 * Built-in registry of known ACP agents. Keyed by short name; used by the
 * CLI's `--agent <name>` flag and by argv preprocessing so an IDE can spawn
 * `acp-devtools` with zero arguments and still get a sensible default.
 *
 * Adding a new agent here is a single PR — no runtime config required. For
 * truly user-specific agents, fall back to the explicit `proxy <command>
 * [args…]` form.
 */
export interface AgentDefinition {
    /** Short, command-line-friendly identifier (used after `--agent`). */
    shortName: string;
    /** Human-readable short label shown in the UI session picker. */
    displayName: string;
    /** Longer description used in help text and the implementation note. */
    description: string;
    /** Executable launched as the actual ACP agent. */
    command: string;
    /** Arguments prepended before any user-supplied positional args. */
    args: readonly string[];
    /**
     * Alternate `[command, ...args]` tuples that should reverse-resolve to
     * this agent in the UI. Useful for deprecated package names so existing
     * captures.db rows still get the friendly display name.
     */
    aliases?: ReadonlyArray<readonly string[]>;
    /**
     * True when the agent ships as a standalone binary (no npm wrapper), so
     * users must install it themselves before the shortcut works. Documented
     * in IDE-config recipes and surfaced in `acp-devtools doctor`.
     */
    requiresExternalInstall?: boolean;
}

export const AGENT_REGISTRY: Readonly<Record<string, AgentDefinition>> = {
    'claude-code': {
        shortName: 'claude-code',
        displayName: 'Claude Code',
        description: 'Anthropic Claude Code via @agentclientprotocol/claude-agent-acp',
        command: 'npx',
        args: ['-y', '@agentclientprotocol/claude-agent-acp'],
        aliases: [
            // The original Zed-scoped package is deprecated as of late 2026,
            // but still very common in existing captures + IDE configs.
            ['npx', '-y', '@zed-industries/claude-code-acp'],
        ],
    },
    codex: {
        shortName: 'codex',
        displayName: 'Codex',
        description: 'OpenAI Codex via @zed-industries/codex-acp',
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
    },
    goose: {
        shortName: 'goose',
        displayName: 'Goose',
        description: 'Block Goose — install separately, then this runs `goose acp`',
        command: 'goose',
        args: ['acp'],
        requiresExternalInstall: true,
    },
    opencode: {
        shortName: 'opencode',
        displayName: 'OpenCode',
        description: 'SST OpenCode — install via opencode.ai/install, then `opencode acp`',
        command: 'opencode',
        args: ['acp'],
        requiresExternalInstall: true,
    },
};

/** The agent picked when `acp-devtools` is launched with no arguments. */
export const DEFAULT_AGENT = 'claude-code';

/** Look up a definition by short name. Throws with a helpful message if unknown. */
export function resolveAgent(shortName: string): AgentDefinition {
    const agent = AGENT_REGISTRY[shortName];
    if (!agent) {
        const available = Object.keys(AGENT_REGISTRY).sort().join(', ');
        throw new Error(`unknown agent "${shortName}". Known shortcuts: ${available}.`);
    }
    return agent;
}

/** True iff this short name is a registered agent shortcut. */
export function isAgentShortcut(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, name);
}

/** Snapshot of the registry for UIs and help text. */
export function listAgents(): AgentDefinition[] {
    return Object.values(AGENT_REGISTRY).slice();
}

/**
 * Reverse-look-up an agent definition from a captured `agentCommand` string
 * (typically of the form `command arg1 arg2 …` as recorded by the proxy).
 * Returns the matching definition when the command + args prefix matches a
 * known shortcut, so the UI can replace the verbose form with a friendly
 * label. Returns `null` for custom agents.
 */
export function detectAgentShortcut(agentCommand: string): AgentDefinition | null {
    const trimmed = agentCommand.trim();
    if (trimmed.length === 0) return null;
    for (const def of Object.values(AGENT_REGISTRY)) {
        const variants: ReadonlyArray<readonly string[]> = [
            [def.command, ...def.args],
            ...(def.aliases ?? []),
        ];
        for (const variant of variants) {
            const exact = variant.join(' ');
            if (trimmed === exact) return def;
            if (trimmed.startsWith(exact + ' ')) return def;
        }
    }
    return null;
}
