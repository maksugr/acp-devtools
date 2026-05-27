import type { CapturedMessage, JsonRpcId, JsonRpcMessage } from '../acp/types.js';

/**
 * Single-direction step in the playback state machine.
 *
 * `emit` — the engine wants to send THIS line to its counterpart.
 * `wait` — the engine wants to consume a line from its counterpart.
 * `done` — script is exhausted.
 *
 * The state machine alternates `wait`/`emit` based on the recorded message's
 * direction relative to the engine's own role (the side it impersonates).
 */
export type PlaybackStep =
    | {
          kind: 'emit';
          line: string;
          message: CapturedMessage;
          /**
           * Wall-clock delta between this message's timestamp and the
           * previous message's timestamp in the script (regardless of
           * direction). Always non-negative; clock-skew is clamped to zero.
           * Zero on the very first message. Callers respecting `--realtime`
           * should `await delay(deltaSincePrevMs)` before emitting; callers
           * that want fast playback (the default) can ignore the field.
           */
          deltaSincePrevMs: number;
      }
    | { kind: 'wait'; expected: CapturedMessage }
    | { kind: 'done' };

export type PlaybackRole = 'agent' | 'editor';

const OUR_DIRECTION_FOR_ROLE: Record<PlaybackRole, CapturedMessage['direction']> = {
    // mock-agent emits agent→editor and waits for editor→agent
    agent: 'agent-to-editor',
    editor: 'editor-to-agent',
};

/**
 * Strict in-order replay state machine. Walks a `SessionExport.messages`
 * array, alternating between EMITting messages from "our" side and WAITing
 * for messages from the other side. Maintains an rpc_id substitution table
 * so responses emitted from the script use the real wire's id (which may
 * differ from the recorded one).
 *
 * v1 limitations (matched against `memory/project_mock_modes_yaml_dsl.md`):
 * - No conditional matching — if the wire's actual request order diverges
 *   from the script, playback breaks. Same prompt = same outcome.
 * - No YAML DSL. Future iteration.
 * - No timing simulation — emits as fast as possible.
 */
export class PlaybackEngine {
    private pointer = 0;
    private readonly scriptIdToRealId = new Map<string, JsonRpcId>();
    private readonly ourDirection: CapturedMessage['direction'];

    constructor(
        private readonly messages: CapturedMessage[],
        role: PlaybackRole,
    ) {
        this.ourDirection = OUR_DIRECTION_FOR_ROLE[role];
    }

    /**
     * Advance through the script until either we have a line to EMIT, we
     * need to WAIT for the other side, or the script is DONE. Notifications
     * on our side are emitted immediately (no waiting).
     */
    next(): PlaybackStep {
        while (this.pointer < this.messages.length) {
            const msg = this.messages[this.pointer]!;
            if (msg.direction === this.ourDirection) {
                const prev = this.pointer > 0 ? this.messages[this.pointer - 1]! : null;
                const deltaSincePrevMs = prev
                    ? Math.max(0, msg.timestamp - prev.timestamp)
                    : 0;
                this.pointer += 1;
                return {
                    kind: 'emit',
                    line: this.buildOutbound(msg),
                    message: msg,
                    deltaSincePrevMs,
                };
            }
            return { kind: 'wait', expected: msg };
        }
        return { kind: 'done' };
    }

    /**
     * Record that the other side sent something the engine was WAITing for.
     * Advances past the matching script frame; remembers the rpc_id mapping
     * so any later response we emit can carry the wire's actual id.
     *
     * Returns `true` when an expected frame was consumed, `false` when there
     * was nothing to consume (script already done or our turn) — caller can
     * decide whether the off-script input is an error or just gets dropped.
     */
    onIncoming(line: string): boolean {
        if (this.pointer >= this.messages.length) return false;
        const msg = this.messages[this.pointer]!;
        if (msg.direction === this.ourDirection) return false;

        // Map scriptRpcId → realRpcId so a later response from script can be
        // patched to use the real id. Notifications carry no id, skip.
        const realId = extractRpcId(line);
        if (msg.rpcId !== undefined && msg.rpcId !== null && realId !== undefined) {
            this.scriptIdToRealId.set(String(msg.rpcId), realId);
        }
        this.pointer += 1;
        return true;
    }

    /** For tests / status output. */
    get position(): number {
        return this.pointer;
    }

    get exhausted(): boolean {
        return this.pointer >= this.messages.length;
    }

    private buildOutbound(msg: CapturedMessage): string {
        if (msg.kind !== 'response' && msg.kind !== 'error') return msg.raw;
        if (msg.rpcId === undefined || msg.rpcId === null) return msg.raw;
        const realId = this.scriptIdToRealId.get(String(msg.rpcId));
        if (realId === undefined) return msg.raw; // no mapping seen yet — emit verbatim
        return substituteRpcId(msg, realId);
    }
}

/** Pure helper — pulled out for testability. Re-serializes the recorded
 * payload with `id` swapped for `realId`. Falls back to the original raw
 * line if the recorded payload couldn't be parsed (parseError sessions). */
export function substituteRpcId(msg: CapturedMessage, realId: JsonRpcId): string {
    if (!msg.payload) return msg.raw;
    const patched: JsonRpcMessage = { ...(msg.payload as JsonRpcMessage), id: realId };
    return JSON.stringify(patched);
}

/** Pull `id` out of a raw JSON-RPC line. Returns undefined for notifications,
 * unparseable input, or when the id field is missing. */
export function extractRpcId(line: string): JsonRpcId | undefined {
    try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === 'string' || typeof parsed.id === 'number') return parsed.id;
        return undefined;
    } catch {
        return undefined;
    }
}
