import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface AgentSubprocessOptions {
    /** Executable name or absolute path of the agent. */
    command: string;
    /** Arguments to pass to the agent. */
    args?: string[];
    /** Working directory for the agent. Defaults to the proxy's cwd. */
    cwd?: string;
    /** Environment for the agent. Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
}

export interface AgentSubprocessHandle {
    pid: number;
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    /** Resolves with `{ code, signal }` after the process exits. */
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    /** Send SIGTERM (or another signal) to the agent. */
    kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Spawns an ACP agent as a child process with all three stdio streams piped
 * so the proxy can observe and forward traffic in both directions.
 */
export function spawnAgent(options: AgentSubprocessOptions): AgentSubprocessHandle {
    const child = spawn(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => resolve({ code, signal }));
        },
    );

    return {
        pid: child.pid ?? -1,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exited,
        kill: (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal),
    };
}
