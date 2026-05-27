import type { ActiveCapture } from '@acp-devtools/core';
import { fetchSavedSessions } from './sessions';
import { useDiscoveryStore } from '../store/discoveryStore';

const POLL_INTERVAL_MS = 2500;

let pollTimer: ReturnType<typeof setInterval> | null = null;

interface ActiveResponse {
    captures: ActiveCapture[];
}

async function fetchActive(): Promise<ActiveCapture[]> {
    const res = await fetch('/api/active', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`discovery: HTTP ${res.status}`);
    const body = (await res.json()) as ActiveResponse;
    return body.captures ?? [];
}

async function tick(): Promise<void> {
    const store = useDiscoveryStore.getState();
    try {
        const [captures, sessions] = await Promise.all([
            fetchActive(),
            fetchSavedSessions().catch(() => store.savedSessions),
        ]);
        store.setCaptures(captures);
        store.setSavedSessions(sessions);
    } catch (err) {
        store.setError(err instanceof Error ? err.message : String(err));
    }
}

export function startDiscoveryPolling(): () => void {
    void tick();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        void tick();
    }, POLL_INTERVAL_MS);
    return () => {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };
}

export function refreshActive(): Promise<void> {
    return tick();
}

/** Re-fetch only the saved-sessions list — used right after import / delete so
 * the picker reflects the change without waiting for the next poll tick. */
export async function refreshSavedSessions(): Promise<void> {
    const store = useDiscoveryStore.getState();
    try {
        const sessions = await fetchSavedSessions();
        store.setSavedSessions(sessions);
    } catch (err) {
        store.setError(err instanceof Error ? err.message : String(err));
    }
}
