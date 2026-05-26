import { detectAgentShortcut } from '@acp-devtools/core/agents';
import type { ActiveCapture, SessionRecord } from '@acp-devtools/core';

/**
 * Best-effort short name for a capture, used in the session picker and the top
 * bar. Resolution order:
 *   1. If the command matches a known agent shortcut (`claude-code`, …),
 *      return the registry's display name ("Claude Code"). This hides the
 *      `@zed-industries/claude-code-acp` package detail from end users.
 *   2. If the command is `npx [-y…] <package>`, return the package name.
 *   3. If it's `node /some/path.js`, return the file basename.
 *   4. Otherwise return the first token of the command.
 */
export function shortAgentName(agentCommand: string): string {
    const known = detectAgentShortcut(agentCommand);
    if (known) return known.displayName;
    const parts = agentCommand.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return agentCommand;
    if (parts[0] === 'npx') {
        for (let i = 1; i < parts.length; i++) {
            const token = parts[i]!;
            if (token.startsWith('-')) continue;
            return token;
        }
    }
    if (parts[0] === 'node' && parts[1]) {
        const file = parts[1].split('/').pop();
        return file ?? parts[1];
    }
    return parts[0]!;
}

export function captureLabel(c: ActiveCapture): string {
    const prefix = c.sessionDbId !== null ? `#${c.sessionDbId}` : `pid ${c.pid}`;
    if (c.sessionName) return `${prefix} · ${c.sessionName}`;
    const agent = shortAgentName(c.agentCommand);
    return c.clientName ? `${prefix} · ${c.clientName} · ${agent}` : `${prefix} · ${agent}`;
}

export function sessionHeader(session: SessionRecord): {
    primary: string;
    secondary: string;
} {
    const primary = session.id > 0 ? `#${session.id}` : 'ephemeral';
    if (session.name) return { primary, secondary: session.name };
    const agent = shortAgentName(session.agentCommand ?? '');
    const secondary = session.clientName ? `${session.clientName} · ${agent}` : agent;
    return { primary, secondary };
}
