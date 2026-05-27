import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDatabase, Session, type CapturedMessage } from '@acp-devtools/core';
import { buildMcpServer } from './mcp.js';

const EXPECTED_TOOLS = [
    'list_sessions',
    'find_sessions_by_client',
    'get_session_metadata',
    'get_latency_stats',
    'get_session_summary',
    'get_session_messages',
    'get_message',
    'get_paired',
    'search_messages',
    'find_spec_violations',
];

let tmp: string;
let dbPath: string;
let sessionId: number;

function mk(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq * 100,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: String(seq),
        raw: `{"jsonrpc":"2.0","id":${seq},"method":"initialize"}`,
        payload: {
            jsonrpc: '2.0',
            id: seq,
            method: 'initialize',
            params: {
                protocolVersion: 1,
                clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
            },
        } as unknown as CapturedMessage['payload'],
        ...overrides,
    };
}

async function withClient(): Promise<{ client: Client; close: () => Promise<void> }> {
    const server = buildMcpServer({ db: dbPath, name: 'test' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}

function parseJsonContent(text: unknown): unknown {
    if (typeof text !== 'string') throw new Error('expected text content');
    return JSON.parse(text);
}

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-devtools-mcp-'));
    dbPath = join(tmp, 'captures.db');
    const db = openDatabase(dbPath);
    const session = Session.start(db, { name: 'mcp-test', agentCommand: 'mock' });
    session.setClientName('Zed');
    session.record(mk(1));
    session.record(
        mk(2, {
            direction: 'agent-to-editor',
            kind: 'response',
            method: undefined,
            // rpcId must match the paired request so buildPairIndex can link them.
            rpcId: '1',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                result: {
                    protocolVersion: 1,
                    agentInfo: { name: 'mock-agent', version: '0.1.0' },
                    agentCapabilities: { loadSession: true },
                },
            } as unknown as CapturedMessage['payload'],
        }),
    );
    session.close();
    sessionId = session.info.id;
    // Backfill structured metadata so find_sessions_by_client has data.
    const reloaded = Session.load(db, sessionId);
    const messages: CapturedMessage[] = [];
    for (const m of reloaded.messages()) messages.push(m);
    reloaded.setMetadataFromMessages(messages);
    db.close();
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

describe('MCP server — tools/list', () => {
    it('exposes every documented tool with a populated schema', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.listTools();
            const names = res.tools.map((t) => t.name).sort();
            expect(names).toEqual([...EXPECTED_TOOLS].sort());
            for (const tool of res.tools) {
                expect(tool.description).toBeTruthy();
                expect(tool.inputSchema).toBeDefined();
            }
        } finally {
            await close();
        }
    });

    it('every tool advertises readOnlyHint=true, idempotentHint=true, openWorldHint=false', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.listTools();
            for (const tool of res.tools) {
                expect(tool.annotations).toBeDefined();
                expect(tool.annotations?.readOnlyHint).toBe(true);
                expect(tool.annotations?.idempotentHint).toBe(true);
                expect(tool.annotations?.openWorldHint).toBe(false);
                expect(typeof tool.annotations?.title).toBe('string');
            }
        } finally {
            await close();
        }
    });
});

describe('MCP server — server-level capabilities', () => {
    it('exposes server-level instructions to guide LLM clients', async () => {
        const { client, close } = await withClient();
        try {
            const instructions = client.getInstructions();
            expect(instructions).toBeTruthy();
            expect(instructions).toContain('Agent Client Protocol');
            // Mentions the read-only contract — agents pick this up when
            // deciding whether the server is safe to call.
            expect(instructions).toMatch(/read-only/i);
            // Names the headline tools so the LLM knows where to start.
            expect(instructions).toContain('get_session_summary');
            expect(instructions).toContain('find_spec_violations');
            // Names the canned prompts so the LLM knows the playbooks exist.
            expect(instructions).toContain('triage_slow_session');
        } finally {
            await close();
        }
    });

    it('every tool declares an outputSchema (modern MCP spec)', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.listTools();
            for (const tool of res.tools) {
                expect(
                    tool.outputSchema,
                    `tool ${tool.name} is missing outputSchema`,
                ).toBeDefined();
            }
        } finally {
            await close();
        }
    });

    it('tool results return structuredContent alongside text content', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'list_sessions',
                arguments: { limit: 10 },
            });
            // Both shapes must be present when outputSchema is declared: text
            // for legacy clients, structuredContent for spec-aware ones.
            expect(res.content).toBeDefined();
            expect(res.structuredContent).toBeDefined();
            expect(res.structuredContent).toHaveProperty('sessions');
        } finally {
            await close();
        }
    });
});

describe('MCP server — prompts', () => {
    it('exposes the three canned investigation playbooks', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.listPrompts();
            const names = res.prompts.map((p) => p.name).sort();
            expect(names).toEqual([
                'audit_spec_violations',
                'compare_clients',
                'triage_slow_session',
            ]);
            for (const p of res.prompts) {
                expect(p.title).toBeTruthy();
                expect(p.description).toBeTruthy();
            }
        } finally {
            await close();
        }
    });

    it('triage_slow_session returns a prompt message that names the right tools', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.getPrompt({
                name: 'triage_slow_session',
                arguments: { session_id: '42' },
            });
            expect(res.messages.length).toBeGreaterThan(0);
            const text = res.messages[0]?.content as { type: string; text?: string };
            expect(text.type).toBe('text');
            // The playbook should reference the canonical tool flow so the
            // LLM doesn't re-derive it from instructions.
            expect(text.text).toContain('get_session_summary');
            expect(text.text).toContain('42');
            expect(text.text).toContain('get_paired');
        } finally {
            await close();
        }
    });

    it('compare_clients requires both client names and embeds them in the prompt', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.getPrompt({
                name: 'compare_clients',
                arguments: { client_a: 'WebStorm', client_b: 'Zed' },
            });
            const text = (res.messages[0]?.content as { text?: string }).text ?? '';
            expect(text).toContain('WebStorm');
            expect(text).toContain('Zed');
            expect(text).toContain('find_sessions_by_client');
        } finally {
            await close();
        }
    });
});

describe('MCP server — tools/call', () => {
    it('list_sessions returns the seeded session', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({ name: 'list_sessions', arguments: { limit: 10 } });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { sessions: Array<{ id: number; client_name: string | null }> };
            expect(body.sessions.length).toBeGreaterThan(0);
            expect(body.sessions[0]?.id).toBe(sessionId);
            expect(body.sessions[0]?.client_name).toBe('Zed');
        } finally {
            await close();
        }
    });

    it('find_sessions_by_client filters by client substring', async () => {
        const { client, close } = await withClient();
        try {
            const hit = await client.callTool({
                name: 'find_sessions_by_client',
                arguments: { client: 'zed' },
            });
            const hitBody = parseJsonContent(
                (hit.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { sessions: Array<{ id: number }> };
            expect(hitBody.sessions.map((s) => s.id)).toContain(sessionId);

            const miss = await client.callTool({
                name: 'find_sessions_by_client',
                arguments: { client: 'NoSuchClient' },
            });
            const missBody = parseJsonContent(
                (miss.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { sessions: unknown[] };
            expect(missBody.sessions).toEqual([]);
        } finally {
            await close();
        }
    });

    it('get_session_metadata returns derived metadata', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_session_metadata',
                arguments: { session_id: sessionId },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as {
                metadata: {
                    protocolVersion: number | null;
                    client: { title: string | null };
                    agent: { name: string | null };
                };
            };
            expect(body.metadata.protocolVersion).toBe(1);
            expect(body.metadata.client.title).toBe('Zed');
            expect(body.metadata.agent.name).toBe('mock-agent');
        } finally {
            await close();
        }
    });

    it('get_latency_stats returns per-method aggregation + insights array', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_latency_stats',
                arguments: { session_id: sessionId },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as {
                perMethod: Array<{ method: string; count: number }>;
                insights: Array<{ kind: string }>;
                sessionLatency: { sampleSize: number };
            };
            const initialize = body.perMethod.find((s) => s.method === 'initialize');
            expect(initialize?.count).toBe(1);
            // `insights` is the new field — agent must not need to compute
            // hotspots itself. Empty array on healthy sessions is fine; the
            // shape is what matters for the contract.
            expect(Array.isArray(body.insights)).toBe(true);
            expect(body.sessionLatency).toBeDefined();
        } finally {
            await close();
        }
    });

    it('get_session_summary bundles metadata + perMethod + insights + totals in one call', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_session_summary',
                arguments: { session_id: sessionId },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as {
                session_id: number;
                metadata: { client: { title: string | null } };
                totals: { messages: number; direction: Record<string, number>; kind: Record<string, number> };
                latency: { sampleSize: number };
                perMethod: unknown[];
                insights: unknown[];
            };
            expect(body.session_id).toBe(sessionId);
            expect(body.metadata.client.title).toBe('Zed');
            expect(body.totals.messages).toBe(2);
            expect(body.totals.direction.editorToAgent).toBe(1);
            expect(body.totals.direction.agentToEditor).toBe(1);
            expect(body.totals.kind.request).toBe(1);
            expect(body.totals.kind.response).toBe(1);
            expect(Array.isArray(body.perMethod)).toBe(true);
            expect(Array.isArray(body.insights)).toBe(true);
            expect(body.latency.sampleSize).toBeGreaterThan(0);
        } finally {
            await close();
        }
    });

    it('get_session_messages filters by kind', async () => {
        const { client, close } = await withClient();
        try {
            const reqOnly = await client.callTool({
                name: 'get_session_messages',
                arguments: { session_id: sessionId, kind: 'request', limit: 10 },
            });
            const body = parseJsonContent(
                (reqOnly.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { messages: Array<{ kind: string }> };
            expect(body.messages.every((m) => m.kind === 'request')).toBe(true);
        } finally {
            await close();
        }
    });

    it('get_message returns a single frame by seq', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_message',
                arguments: { session_id: sessionId, seq: 1 },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { message: { seq: number; method?: string } };
            expect(body.message.seq).toBe(1);
            expect(body.message.method).toBe('initialize');
        } finally {
            await close();
        }
    });

    it('get_message returns an error result for an unknown seq', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_message',
                arguments: { session_id: sessionId, seq: 999 },
            });
            expect(res.isError).toBe(true);
        } finally {
            await close();
        }
    });

    it('get_paired returns the matched request/response pair with latency', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'get_paired',
                arguments: { session_id: sessionId, seq: 1 },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { paired: { pairSeq: number; latencyMs: number } | null };
            expect(body.paired?.pairSeq).toBe(2);
            expect(body.paired?.latencyMs).toBeGreaterThanOrEqual(0);
        } finally {
            await close();
        }
    });

    it('search_messages finds substring hits across raw frames', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'search_messages',
                arguments: { session_id: sessionId, query: 'initialize' },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { matches: Array<{ seq: number }>; total: number };
            expect(body.matches.length).toBeGreaterThan(0);
            expect(body.total).toBe(body.matches.length);
        } finally {
            await close();
        }
    });

    it('find_spec_violations validates frames against the ACP schema', async () => {
        const { client, close } = await withClient();
        try {
            const res = await client.callTool({
                name: 'find_spec_violations',
                arguments: { session_id: sessionId },
            });
            const body = parseJsonContent(
                (res.content as Array<{ text?: unknown }>)[0]?.text,
            ) as { checked: number; violations: Array<unknown> };
            expect(body.checked).toBeGreaterThan(0);
            expect(Array.isArray(body.violations)).toBe(true);
        } finally {
            await close();
        }
    });
});
