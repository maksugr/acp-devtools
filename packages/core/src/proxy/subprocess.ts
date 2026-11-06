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
    /**
     * After the agent exits, how long to keep waiting for its stdout/stderr
     * to close before treating it as done. Defaults to 2000 ms.
     */
    stdioGraceMs?: number;
}

const DEFAULT_STDIO_GRACE_MS = 2_000;

export interface AgentSubprocessHandle {
    pid: number;
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    /**
     * Resolves with `{ code, signal }` once the process has exited and its
     * stdio has been drained (or the grace period after exit has passed).
     */
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

    // `exit` can fire before the agent's last stdout bytes have been read —
    // routinely on Windows pipes — and the proxy shuts down on `exited`, so
    // resolving there dropped the agent's final frames from the capture.
    // `close` fires once every stdio stream has ended. The grace timer covers
    // a child process the agent left behind that inherited stdout and keeps
    // it open, which would otherwise hold the proxy open with it.
    const graceMs = options.stdioGraceMs ?? DEFAULT_STDIO_GRACE_MS;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
            let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
            let graceTimer: NodeJS.Timeout | undefined;
            const finish = (info: { code: number | null; signal: NodeJS.Signals | null }) => {
                clearTimeout(graceTimer);
                resolve(info);
            };
            child.once('error', reject);
            child.once('exit', (code, signal) => {
                exitInfo = { code, signal };
                graceTimer = setTimeout(() => finish(exitInfo!), graceMs);
            });
            child.once('close', (code, signal) => finish(exitInfo ?? { code, signal }));
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
