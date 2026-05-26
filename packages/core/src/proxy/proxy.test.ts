import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedMessage } from '../acp/types.js';
import type { AgentSubprocessHandle, AgentSubprocessOptions } from './subprocess.js';

// We mock spawnAgent so the proxy never starts a real child. Each test sets
// up the fake handle through `nextHandle` before calling `proxy.start()`.
let nextHandle: AgentSubprocessHandle | null = null;
let lastSpawnOptions: AgentSubprocessOptions | null = null;

vi.mock('./subprocess.js', () => ({
    spawnAgent: (options: AgentSubprocessOptions) => {
        lastSpawnOptions = options;
        if (!nextHandle) throw new Error('test: nextHandle not set');
        return nextHandle;
    },
}));

// Importing AcpProxy AFTER the mock above is required so the proxy resolves
// the mocked `spawnAgent`. Use a top-level dynamic import in beforeEach.
import type * as ProxyModule from './proxy.js';
let ProxyMod: typeof ProxyModule;

interface FakeAgent {
    handle: AgentSubprocessHandle;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exit: (code: number | null, signal: NodeJS.Signals | null) => void;
    killCalls: NodeJS.Signals[];
}

function makeFakeAgent(): FakeAgent {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const killCalls: NodeJS.Signals[] = [];
    let resolveExit!: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
        resolveExit = res;
    });
    const handle: AgentSubprocessHandle = {
        pid: 4242,
        stdin,
        stdout,
        stderr,
        exited,
        kill: (signal: NodeJS.Signals = 'SIGTERM') => {
            killCalls.push(signal);
            return true;
        },
    };
    return {
        handle,
        stdin,
        stdout,
        stderr,
        exit: (code, signal) => resolveExit({ code, signal }),
        killCalls,
    };
}

beforeEach(async () => {
    vi.resetModules();
    nextHandle = null;
    lastSpawnOptions = null;
    ProxyMod = await import('./proxy.js');
});

afterEach(() => {
    nextHandle = null;
});

describe('AcpProxy.start()', () => {
    it('emits "started" with the agent pid', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const startedPromise = new Promise<{ pid: number }>((resolve) => {
            proxy.on('started', resolve);
        });
        await proxy.start();
        const info = await startedPromise;
        expect(info.pid).toBe(4242);
    });

    it('forwards spawnAgent options through unchanged', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'goose',
            args: ['acp'],
            cwd: '/tmp',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        await proxy.start();
        expect(lastSpawnOptions?.command).toBe('goose');
        expect(lastSpawnOptions?.args).toEqual(['acp']);
        expect(lastSpawnOptions?.cwd).toBe('/tmp');
    });

    it('throws if start() is called twice', async () => {
        nextHandle = makeFakeAgent().handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        await proxy.start();
        nextHandle = makeFakeAgent().handle;
        await expect(proxy.start()).rejects.toThrow(/already started/);
    });
});

describe('AcpProxy capture flow', () => {
    it('captures editor→agent frames and pipes them to the agent', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const messages: CapturedMessage[] = [];
        proxy.on('message', (m) => messages.push(m));
        await proxy.start();

        // Frame received from the agent's stdin (what the proxy writes to it):
        const agentReceived: Buffer[] = [];
        agent.stdin.on('data', (chunk: Buffer) => agentReceived.push(chunk));

        editorIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
        await new Promise((r) => setImmediate(r));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.direction).toBe('editor-to-agent');
        expect(messages[0]?.kind).toBe('request');
        expect(messages[0]?.method).toBe('initialize');
        expect(messages[0]?.rpcId).toBe(1);

        expect(Buffer.concat(agentReceived).toString()).toContain('"initialize"');
    });

    it('captures agent→editor frames and pipes them to the editor', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const messages: CapturedMessage[] = [];
        proxy.on('message', (m) => messages.push(m));
        await proxy.start();

        const editorReceived: Buffer[] = [];
        editorOut.on('data', (chunk: Buffer) => editorReceived.push(chunk));

        agent.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
        await new Promise((r) => setImmediate(r));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.direction).toBe('agent-to-editor');
        expect(messages[0]?.kind).toBe('response');
        expect(Buffer.concat(editorReceived).toString()).toContain('"result"');
    });

    it('assigns incrementing seq values across both directions', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const seqs: number[] = [];
        proxy.on('message', (m) => seqs.push(m.seq));
        await proxy.start();

        editorIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
        agent.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
        editorIn.write('{"jsonrpc":"2.0","method":"some/notification"}\n');
        await new Promise((r) => setImmediate(r));

        expect(seqs).toEqual([1, 2, 3]);
    });

    it('joins partial lines across chunks before parsing', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const messages: CapturedMessage[] = [];
        proxy.on('message', (m) => messages.push(m));
        await proxy.start();

        editorIn.write('{"jsonrpc":"2.0",');
        editorIn.write('"id":7,"method":"');
        editorIn.write('initialize"}\n');
        await new Promise((r) => setImmediate(r));
        expect(messages).toHaveLength(1);
        expect(messages[0]?.method).toBe('initialize');
        expect(messages[0]?.rpcId).toBe(7);
    });
});

describe('AcpProxy lifecycle events', () => {
    it('emits "editor-end" and ends the agent stdin when editor stream closes', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const ended = new Promise<void>((resolve) => proxy.on('editor-end', () => resolve()));
        const agentStdinEnded = new Promise<void>((resolve) =>
            agent.stdin.on('finish', () => resolve()),
        );
        await proxy.start();
        editorIn.end();
        await ended;
        await agentStdinEnded;
    });

    it('emits "agent-exit" once the agent process exits', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve) => proxy.on('agent-exit', resolve),
        );
        await proxy.start();
        agent.exit(0, null);
        const info = await exitPromise;
        expect(info.code).toBe(0);
        expect(info.signal).toBeNull();
    });

    it('kill() forwards the signal to the agent', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        await proxy.start();
        proxy.kill('SIGINT');
        expect(agent.killCalls).toEqual(['SIGINT']);
    });

    it('waitForExit() throws before start()', () => {
        const proxy = new ProxyMod.AcpProxy({ command: 'mock' });
        expect(() => proxy.waitForExit()).toThrow(/not started/);
    });

    it('emits "agent-stderr" for each stderr chunk', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const errSink = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: errSink,
        });
        const chunks: Buffer[] = [];
        proxy.on('agent-stderr', (c) => chunks.push(c));
        await proxy.start();
        agent.stderr.write(Buffer.from('error message\n'));
        await new Promise((r) => setImmediate(r));
        expect(Buffer.concat(chunks).toString()).toBe('error message\n');
    });

    it('skips agent-stderr subscription when agentErrorOutput is null', async () => {
        const agent = makeFakeAgent();
        nextHandle = agent.handle;
        const editorIn = new PassThrough();
        const editorOut = new PassThrough();
        const proxy = new ProxyMod.AcpProxy({
            command: 'mock',
            editorInput: editorIn,
            editorOutput: editorOut,
            agentErrorOutput: null,
        });
        const chunks: Buffer[] = [];
        proxy.on('agent-stderr', (c) => chunks.push(c));
        await proxy.start();
        agent.stderr.write(Buffer.from('discard me\n'));
        await new Promise((r) => setImmediate(r));
        expect(chunks).toHaveLength(0);
    });
});
