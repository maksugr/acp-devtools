export interface ServerInfo {
    binaryPath: string | null;
    platform: string;
    arch: string;
}

let cached: ServerInfo | null = null;
let inflight: Promise<ServerInfo> | null = null;

/**
 * Fetch (and cache for the lifetime of the tab) metadata about the server
 * process behind this UI — most importantly the absolute path of the
 * acp-devtools binary, which the EmptyState pre-fills into IDE-config
 * snippets so users can copy-paste without running `which acp-devtools`.
 *
 * In Vite dev mode the binary path is `null` (the server is `vite`, not the
 * CLI); the UI falls back to a placeholder in that case.
 */
export async function fetchServerInfo(): Promise<ServerInfo> {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
        const res = await fetch('/api/info', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`info: HTTP ${res.status}`);
        const body = (await res.json()) as ServerInfo;
        cached = body;
        return body;
    })();
    try {
        return await inflight;
    } finally {
        inflight = null;
    }
}
