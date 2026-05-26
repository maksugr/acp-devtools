import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Root directory for acp-devtools state (discovery descriptors, default
 * captures.db, future MCP socket etc). Overridden by `ACP_DEVTOOLS_HOME`
 * for tests and namespaced environments.
 */
export function acpHomeDir(): string {
    return process.env.ACP_DEVTOOLS_HOME ?? join(homedir(), '.acp-devtools');
}

/**
 * Default path for the shared captures SQLite database. Every proxy without
 * an explicit `--save-to` writes here so sessions accumulate with globally
 * unique ids.
 */
export function defaultCapturesDbPath(): string {
    return join(acpHomeDir(), 'captures.db');
}
