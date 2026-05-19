import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CapturedMessage } from '../acp/types.js';
import type { SessionRecord } from '../storage/session.js';
import { WsBroadcaster } from './server.js';
import type { WsEvent } from './events.js';

const sessionFixture = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    id: 1,
    name: 'test',
    agentCommand: 'mock',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    ...overrides,
});

const messageFixture = (seq: number): CapturedMessage => ({
    seq,
    timestamp: 1_700_000_000_000 + seq,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: seq,
    raw: `{"jsonrpc":"2.0","id":${seq},"method":"initialize","params":{}}`,
    payload: { jsonrpc: '2.0', id: seq, method: 'initialize', params: {} },
});

/**
 * Open a client and start buffering events immediately so that no message sent
 * before the consumer calls `waitFor` is lost.
 */
async function connect(
    url: string,
): Promise<{
    ws: WebSocket;
    events: WsEvent[];
    waitFor: (count: number, timeoutMs?: number) => Promise<WsEvent[]>;
}> {
    const ws = new WebSocket(url);
    const events: WsEvent[] = [];
    const waiters: Array<{ count: number; resolve: () => void; reject: (err: Error) => void }> =
        [];

    ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()) as WsEvent);
        for (const w of [...waiters]) {
            if (events.length >= w.count) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve();
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });

    const waitFor = (count: number, timeoutMs = 1000): Promise<WsEvent[]> =>
        new Promise((resolve, reject) => {
            if (events.length >= count) {
                resolve([...events]);
                return;
            }
            const timer = setTimeout(() => {
                reject(new Error(`timed out waiting for ${count} events (got ${events.length})`));
            }, timeoutMs);
            waiters.push({
                count,
                resolve: () => {
                    clearTimeout(timer);
                    resolve([...events]);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
        });

    return { ws, events, waitFor };
}

describe('WsBroadcaster', () => {
    let broadcaster: WsBroadcaster;
    let url: string;

    beforeEach(async () => {
        broadcaster = new WsBroadcaster({ port: 0 });
        ({ url } = await broadcaster.start());
    });

    afterEach(async () => {
        await broadcaster.stop();
    });

    it('replays the backlog and then streams live messages', async () => {
        const session = sessionFixture();
        broadcaster.publishSessionStart(session);
        broadcaster.publishMessage(messageFixture(1));

        const client = await connect(url);
        const initial = await client.waitFor(3);
        expect(initial.map((e) => e.type)).toEqual(['session.start', 'message', 'replay.done']);

        broadcaster.publishMessage(messageFixture(2));
        const after = await client.waitFor(4);
        expect(after[3]?.type).toBe('message');
        if (after[3]?.type === 'message') expect(after[3].message.seq).toBe(2);

        client.ws.close();
    });

    it('fans out to multiple clients', async () => {
        const session = sessionFixture();
        broadcaster.publishSessionStart(session);

        const a = await connect(url);
        const b = await connect(url);
        await Promise.all([a.waitFor(2), b.waitFor(2)]);

        broadcaster.publishMessage(messageFixture(7));
        const [aEvents, bEvents] = await Promise.all([a.waitFor(3), b.waitFor(3)]);

        const aLast = aEvents[2];
        const bLast = bEvents[2];
        expect(aLast).toEqual(bLast);
        if (aLast?.type === 'message') expect(aLast.message.seq).toBe(7);

        a.ws.close();
        b.ws.close();
    });

    it('serves loadHistory snapshot to late connections', async () => {
        const session = sessionFixture({ endedAt: 1_700_000_000_500 });
        broadcaster.loadHistory(session, [messageFixture(1), messageFixture(2)]);

        const client = await connect(url);
        const events = await client.waitFor(5);
        expect(events.map((e) => e.type)).toEqual([
            'session.start',
            'message',
            'message',
            'replay.done',
            'session.end',
        ]);
        client.ws.close();
    });

    it('emits session.end live to existing clients', async () => {
        const session = sessionFixture();
        broadcaster.publishSessionStart(session);

        const client = await connect(url);
        await client.waitFor(2); // session.start + replay.done

        broadcaster.publishSessionEnd({ ...session, endedAt: 1_700_000_001_000 });
        const events = await client.waitFor(3);
        expect(events[2]?.type).toBe('session.end');
        client.ws.close();
    });
});
