import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { DEFAULT_AGENT, isAgentShortcut, resolveAgent } from '@acp-devtools/core';

export type Editor = 'zed' | 'jetbrains';

export const EDITORS: readonly Editor[] = ['zed', 'jetbrains'];

export function isEditor(value: string): value is Editor {
    return (EDITORS as readonly string[]).includes(value);
}

/** Absolute path to Zed's user settings file for the current platform. */
export function zedSettingsPath(): string {
    if (platform() === 'win32') {
        return join(process.env.APPDATA ?? '', 'Zed', 'settings.json');
    }
    if (platform() === 'darwin') {
        return join(homedir(), '.config', 'zed', 'settings.json');
    }
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'zed', 'settings.json');
}

/** Absolute path to the global JetBrains ACP agent config (shared by all IDEs). */
export function jetbrainsConfigPath(): string {
    return join(homedir(), '.jetbrains', 'acp.json');
}

export interface EditorInfo {
    id: Editor;
    label: string;
    configPath: string;
    /** Where the `agent_servers` block lives, phrased for end users. */
    placement: string;
    /** What to do after editing so the agent shows up. */
    restart: string;
    /** True when the file IS the agent config (JetBrains), false when the block
     *  is one key among many in a larger settings file (Zed). */
    dedicatedFile: boolean;
}

export function editorInfo(editor: Editor): EditorInfo {
    if (editor === 'zed') {
        return {
            id: 'zed',
            label: 'Zed',
            configPath: zedSettingsPath(),
            placement:
                'add the agent_servers block to Zed’s settings.json (create the file or the key if missing)',
            restart: 'reopen the agent panel so Zed re-reads the config',
            dedicatedFile: false,
        };
    }
    return {
        id: 'jetbrains',
        label: 'JetBrains',
        configPath: jetbrainsConfigPath(),
        placement:
            'write this to the global JetBrains ACP config (create it if missing — every JetBrains IDE shares this one file)',
        restart: 'restart the AI chat tool window (close and reopen it)',
        dedicatedFile: true,
    };
}

export interface AgentServerEntry {
    type: 'custom';
    command: string;
    args: string[];
}

export interface SetupPlan {
    editor: EditorInfo;
    displayName: string;
    entry: AgentServerEntry;
    /** True when the target is wrapped via `proxy <command>` (not a registry shortcut). */
    isCustom: boolean;
    /** Registry description / install hint, surfaced for shortcut agents. */
    agentDescription?: string;
    requiresExternalInstall: boolean;
}

/** Derive a short display name for a custom `proxy <command>` target. */
export function deriveCustomName(target: readonly string[]): string {
    const first = target[0] ?? 'agent';
    if (first === 'npx') {
        for (let i = 1; i < target.length; i++) {
            const token = target[i]!;
            if (!token.startsWith('-')) return token;
        }
    }
    return first.split(/[/\\]/).pop() || first;
}

/**
 * Resolve what an editor entry should contain for a given target. `target` is
 * the raw positional list: a single registry shortcut (`['junie']`) resolves to
 * the bare-shortcut form (`args: ['junie']`); anything else is wrapped as
 * `proxy <command…>`. An empty target defaults to the registry default agent.
 */
export function buildSetupPlan(input: {
    target: readonly string[];
    editor: Editor;
    selfPath: string;
    name?: string;
}): SetupPlan {
    const target = input.target.length > 0 ? [...input.target] : [DEFAULT_AGENT];
    const single = target.length === 1 ? target[0]! : null;

    let args: string[];
    let displayName: string;
    let isCustom: boolean;
    let agentDescription: string | undefined;
    let requiresExternalInstall = false;

    if (single !== null && isAgentShortcut(single)) {
        const def = resolveAgent(single);
        args = [def.shortName];
        displayName = input.name ?? `${def.displayName} (via ACP Devtools)`;
        isCustom = false;
        agentDescription = def.description;
        requiresExternalInstall = def.requiresExternalInstall ?? false;
    } else {
        args = ['proxy', ...target];
        displayName = input.name ?? `${deriveCustomName(target)} (via ACP Devtools)`;
        isCustom = true;
    }

    return {
        editor: editorInfo(input.editor),
        displayName,
        entry: { type: 'custom', command: input.selfPath, args },
        isCustom,
        agentDescription,
        requiresExternalInstall,
    };
}

/** Render the JSON block a user pastes by hand, editor-appropriate. */
export function renderConfigBlock(plan: SetupPlan): string {
    const entries = { [plan.displayName]: plan.entry };
    if (plan.editor.dedicatedFile) {
        return JSON.stringify({ agent_servers: entries }, null, 4);
    }
    return `"agent_servers": ${JSON.stringify(entries, null, 4)}`;
}

export interface MergeResult {
    text: string;
    /** True when an entry with the same name already existed and was overwritten. */
    replaced: boolean;
}

/** Infer the indentation a file already uses, so an inserted entry matches it. */
export function detectFormatting(text: string): { insertSpaces: boolean; tabSize: number } {
    const match = text.match(/\n([ \t]+)\S/);
    if (!match) return { insertSpaces: true, tabSize: 4 };
    const ws = match[1]!;
    if (ws.startsWith('\t')) return { insertSpaces: false, tabSize: 1 };
    return { insertSpaces: true, tabSize: ws.length };
}

/**
 * Insert a single agent entry into an existing config file's text, touching only
 * the `agent_servers.<name>` slot. Uses `jsonc-parser` so the rest of the file —
 * its indentation, key order, blank lines, and any comments / trailing commas
 * (Zed's settings.json often has them) — is preserved byte-for-byte; the new
 * entry is indented to match the file. A genuinely malformed file (a real syntax
 * error, not comments) throws, so the caller can fall back to printing the block.
 */
export function mergeIntoConfig(
    existing: string | null,
    name: string,
    entry: AgentServerEntry,
): MergeResult {
    const base = existing !== null && existing.trim().length > 0 ? existing : '{}';
    const errors: ParseError[] = [];
    const root: unknown = parse(base, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        throw new Error('config is not valid JSON');
    }
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
        throw new Error('config root is not a JSON object');
    }
    const servers = (root as Record<string, unknown>).agent_servers;
    const replaced =
        typeof servers === 'object' && servers !== null && !Array.isArray(servers)
            ? Object.prototype.hasOwnProperty.call(servers, name)
            : false;
    const edits = modify(base, ['agent_servers', name], entry, {
        formattingOptions: detectFormatting(base),
    });
    let text = applyEdits(base, edits);
    if (!text.endsWith('\n')) text += '\n';
    return { text, replaced };
}
