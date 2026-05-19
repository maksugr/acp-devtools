import type { ActiveCapture, SessionRecord } from '@acp-devtools/core';

/**
 * Best-effort short name for a capture, used in the session picker and the top
 * bar. Strips wrapping shells like `npx -y ...` and trims to the package name.
 */
export function shortAgentName(agentCommand: string): string {
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
    const name = c.sessionName ?? shortAgentName(c.agentCommand);
    return `${prefix} · ${name}`;
}

export function sessionHeader(session: SessionRecord): {
    primary: string;
    secondary: string;
} {
    const primary = session.id > 0 ? `#${session.id}` : 'ephemeral';
    const secondary = session.name ?? shortAgentName(session.agentCommand ?? '');
    return { primary, secondary };
}
