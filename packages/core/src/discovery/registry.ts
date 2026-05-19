import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ActiveCapture } from './types.js';

const DEFAULT_BASE = join(homedir(), '.acp-devtools');

/**
 * Resolve the discovery base directory, optionally overridden by env. Useful
 * for tests and for users who want to namespace by host (e.g. devcontainer).
 */
export function discoveryBaseDir(): string {
    return process.env.ACP_DEVTOOLS_HOME ?? DEFAULT_BASE;
}

export function activeDir(): string {
    return join(discoveryBaseDir(), 'active');
}

function ensureActiveDir(): string {
    const dir = activeDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function pidFile(pid: number): string {
    return join(activeDir(), `${pid}.json`);
}

/** Write or replace the descriptor for the current process. */
export function writeActiveFile(record: ActiveCapture): string {
    ensureActiveDir();
    const path = pidFile(record.pid);
    writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
    return path;
}

/** Remove the descriptor for the given PID; safe if it does not exist. */
export function removeActiveFile(pid: number): void {
    try {
        rmSync(pidFile(pid), { force: true });
    } catch {
        // ignore
    }
}

/** True iff the process with `pid` still exists. */
export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export interface ListActiveOptions {
    /** Remove descriptors whose owning process is dead. Default: true. */
    pruneStale?: boolean;
}

/**
 * Read every descriptor in the active directory. Stale files (process gone)
 * are removed by default so the list stays cheap to consume.
 */
export function listActive(options: ListActiveOptions = {}): ActiveCapture[] {
    const { pruneStale = true } = options;
    let entries: string[] = [];
    try {
        entries = readdirSync(activeDir());
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
    const out: ActiveCapture[] = [];
    for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const path = join(activeDir(), name);
        let parsed: ActiveCapture | null = null;
        try {
            parsed = JSON.parse(readFileSync(path, 'utf8')) as ActiveCapture;
        } catch {
            if (pruneStale) rmSync(path, { force: true });
            continue;
        }
        if (!parsed || parsed.version !== 1 || typeof parsed.pid !== 'number') {
            if (pruneStale) rmSync(path, { force: true });
            continue;
        }
        if (!isPidAlive(parsed.pid)) {
            if (pruneStale) rmSync(path, { force: true });
            continue;
        }
        out.push(parsed);
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
}
