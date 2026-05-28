import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';

export interface SavedSession {
    id: number;
    name: string | null;
    agent_command: string | null;
    started_at: number;
    ended_at: number | null;
    message_count: number;
    client_name: string | null;
    imported_at: number | null;
    // v4 structured-metadata columns — all nullable. NULL when the session
    // predates Phase C or the proxy hasn't seen `initialize` yet.
    client_version: string | null;
    client_platform: string | null;
    agent_name: string | null;
    agent_version: string | null;
    protocol_version: number | null;
    current_mode: string | null;
    current_model: string | null;
}

interface SessionsResponse {
    sessions: SavedSession[];
}

export interface SessionMessagesResponse {
    session: SessionRecord;
    messages: CapturedMessage[];
}

/**
 * Fetch the full ordered frame list for one saved session, plus its record.
 * The replay WS streams frames for the live timeline; the DiffPanel needs the
 * whole set at once to align against the current session, so this is a plain
 * one-shot JSON fetch against `GET /api/sessions/:id/messages`.
 */
export async function fetchSessionMessages(id: number): Promise<SessionMessagesResponse> {
    const res = await fetch(`/api/sessions/${id}/messages`, {
        headers: { accept: 'application/json' },
    });
    if (!res.ok) {
        const message = await extractError(res);
        throw new Error(message);
    }
    return (await res.json()) as SessionMessagesResponse;
}

export interface ImportResponse {
    id: number;
    messageCount: number;
}

export async function fetchSavedSessions(): Promise<SavedSession[]> {
    const res = await fetch('/api/sessions', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`sessions: HTTP ${res.status}`);
    const body = (await res.json()) as SessionsResponse;
    return body.sessions ?? [];
}

/**
 * Upload a JSON export to the server, which parses it, inserts a new session
 * into `captures.db` with `imported_at = now()`, and returns the new id.
 * Throws on any non-2xx status with the server's `error` field (or the raw
 * status text) as the message so the UI toast surfaces something useful.
 */
export async function importSession(file: File): Promise<ImportResponse> {
    const text = await file.text();
    const res = await fetch('/api/import', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-acp-source-filename': sanitizeHeaderValue(file.name),
        },
        body: text,
    });
    if (!res.ok) {
        const message = await extractError(res);
        throw new Error(message);
    }
    return (await res.json()) as ImportResponse;
}

export async function deleteSession(id: number): Promise<void> {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        const message = await extractError(res);
        throw new Error(message);
    }
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

async function extractError(res: Response): Promise<string> {
    try {
        const body = (await res.json()) as { error?: string };
        if (body.error) return body.error;
    } catch {
        // fall through
    }
    return `HTTP ${res.status} ${res.statusText}`;
}

function sanitizeHeaderValue(value: string): string {
    // Headers must be ISO-8859-1; strip anything outside printable ASCII to
    // sidestep `TypeError: Invalid header value` for unicode filenames.
    return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 200);
}
