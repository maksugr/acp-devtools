export interface SavedSession {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    message_count: number;
}

interface SessionsResponse {
    sessions: SavedSession[];
}

export async function fetchSavedSessions(): Promise<SavedSession[]> {
    const res = await fetch('/api/sessions', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`sessions: HTTP ${res.status}`);
    const body = (await res.json()) as SessionsResponse;
    return body.sessions ?? [];
}

export function replayUrlFor(sessionId: number): string {
    return `ws://${window.location.host}/replay/${sessionId}`;
}

export function isReplayUrl(url: string | null): boolean {
    return url !== null && /\/replay\/\d+$/.test(url);
}

export function sessionIdFromReplayUrl(url: string): number | null {
    const m = url.match(/\/replay\/(\d+)$/);
    return m ? Number(m[1]) : null;
}
