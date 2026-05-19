import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { LineFramer, parseFrame } from '../acp/parser.js';
import type { CapturedMessage, MessageDirection } from '../acp/types.js';
import {
    spawnAgent,
    type AgentSubprocessHandle,
    type AgentSubprocessOptions,
} from './subprocess.js';

export interface AcpProxyOptions extends AgentSubprocessOptions {
    /** Stream the editor sends ACP messages on. Defaults to `process.stdin`. */
    editorInput?: Readable;
    /** Stream the editor reads ACP messages from. Defaults to `process.stdout`. */
    editorOutput?: Writable;
    /** Where to forward the agent's stderr. Defaults to `process.stderr`. Pass `null` to discard. */
    agentErrorOutput?: Writable | null;
}

type ProxyEvent = 'message' | 'agent-stderr' | 'agent-exit' | 'editor-end' | 'error' | 'started';

/**
 * Bidirectional transparent ACP proxy.
 *
 * Forwards bytes from editor stdin to agent stdin and from agent stdout to
 * editor stdout while emitting a `CapturedMessage` for every newline-delimited
 * JSON-RPC frame observed in either direction. Neither side is aware of the
 * proxy as long as `agentInfoLog` writes go to a different stream than
 * `editorOutput`.
 */
export class AcpProxy extends EventEmitter {
    private agent: AgentSubprocessHandle | null = null;
    private seq = 0;
    private readonly editorFramer = new LineFramer();
    private readonly agentFramer = new LineFramer();

    constructor(private readonly options: AcpProxyOptions) {
        super();
    }

    override on(event: 'message', listener: (msg: CapturedMessage) => void): this;
    override on(event: 'agent-stderr', listener: (chunk: Buffer) => void): this;
    override on(
        event: 'agent-exit',
        listener: (info: { code: number | null; signal: NodeJS.Signals | null }) => void,
    ): this;
    override on(event: 'editor-end', listener: () => void): this;
    override on(event: 'error', listener: (err: Error) => void): this;
    override on(event: 'started', listener: (info: { pid: number }) => void): this;
    override on(event: ProxyEvent, listener: (...args: never[]) => void): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    async start(): Promise<void> {
        if (this.agent) throw new Error('proxy already started');

        const agent = spawnAgent(this.options);
        this.agent = agent;
        this.emit('started', { pid: agent.pid });

        const editorIn = this.options.editorInput ?? process.stdin;
        const editorOut = this.options.editorOutput ?? process.stdout;
        const agentErr =
            this.options.agentErrorOutput === undefined
                ? process.stderr
                : this.options.agentErrorOutput;

        editorIn.on('data', (chunk: Buffer | string) => {
            this.capture('editor-to-agent', chunk);
            agent.stdin.write(chunk);
        });
        editorIn.once('end', () => {
            this.emit('editor-end');
            agent.stdin.end();
        });
        editorIn.on('error', (err) => this.emit('error', err));

        agent.stdout.on('data', (chunk: Buffer | string) => {
            this.capture('agent-to-editor', chunk);
            editorOut.write(chunk);
        });
        agent.stdout.on('error', (err) => this.emit('error', err));

        if (agentErr) {
            agent.stderr.on('data', (chunk: Buffer) => {
                this.emit('agent-stderr', chunk);
                agentErr.write(chunk);
            });
        }

        agent.exited
            .then((info) => this.emit('agent-exit', info))
            .catch((err: Error) => this.emit('error', err));
    }

    /** Wait for the underlying agent to exit. */
    waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
        if (!this.agent) throw new Error('proxy not started');
        return this.agent.exited;
    }

    /** Send a signal to the agent. */
    kill(signal: NodeJS.Signals = 'SIGTERM'): void {
        this.agent?.kill(signal);
    }

    private capture(direction: MessageDirection, chunk: Buffer | string): void {
        const framer = direction === 'editor-to-agent' ? this.editorFramer : this.agentFramer;
        const frames = framer.feed(chunk);
        for (const raw of frames) {
            const parsed = parseFrame(raw);
            const msg: CapturedMessage = {
                seq: ++this.seq,
                timestamp: Date.now(),
                direction,
                kind: parsed.kind,
                raw,
                payload: parsed.payload,
            };
            if (parsed.method !== undefined) msg.method = parsed.method;
            if (parsed.rpcId !== undefined) msg.rpcId = parsed.rpcId;
            if (parsed.parseError !== undefined) msg.parseError = parsed.parseError;
            this.emit('message', msg);
        }
    }
}
