import type { CapturedMessage } from '../acp/types.js';
import type { SessionRecord } from '../storage/session.js';

/**
 * Wire-format events streamed by the acp-devtools WebSocket server.
 *
 * `session.start` is sent first to every client. Then the server replays any
 * messages it already has, emits `replay.done`, and from that point on streams
 * `message` events live. `session.end` arrives when the capture ends.
 */
export type WsEvent =
    | { type: 'session.start'; session: SessionRecord }
    | { type: 'message'; message: CapturedMessage }
    | { type: 'replay.done' }
    | { type: 'session.end'; session: SessionRecord };

export const WS_PROTOCOL_VERSION = 1;
