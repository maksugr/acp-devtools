/**
 * On-disk descriptor for a live ACP capture. The proxy CLI writes one of these
 * per process under `<base>/active/<pid>.json` (default base `~/.acp-devtools`).
 * The UI scans that directory to enumerate currently-attachable captures.
 */
export interface ActiveCapture {
    /** Schema version for forward-compat. Increment on incompatible changes. */
    version: 1;
    /** PID of the proxy process owning this capture. */
    pid: number;
    /** WebSocket host the proxy is bound to. */
    host: string;
    /** WebSocket port the proxy is bound to (may be ephemeral). */
    port: number;
    /** Full URL clients should connect to. Convenience field; equals `ws://host:port`. */
    url: string;
    /** The agent command the proxy is wrapping. */
    agentCommand: string;
    /** Optional human label. */
    sessionName: string | null;
    /** SQLite row id of the session (when `--save-to` is used), else null. */
    sessionDbId: number | null;
    /** Absolute path of the SQLite file the session is saved to, if any. */
    saveTo: string | null;
    /** Unix milliseconds when the proxy started. */
    startedAt: number;
    /**
     * Human-readable client identifier from the first `initialize.params.clientInfo.title`
     * — e.g. `"Zed"`, `"WebStorm 2026.1.2"`. Populated by the proxy a few ms after
     * the editor sends its first frame; null before then.
     */
    clientName?: string | null;
}
