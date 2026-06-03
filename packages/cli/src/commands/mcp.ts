import type { Command } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    buildMetadataDiff,
    buildMethodStatsDiff,
    buildPairIndex,
    buildPerformanceInsights,
    buildPerMethodStats,
    buildSessionDiff,
    type CapturedMessage,
    defaultCapturesDbPath,
    extractSessionMetadata,
    findSessionsByClient,
    listSessionsSummary,
    openDatabase,
    percentile,
    redactMessage,
    Session,
    validateAcpMessage,
} from '@acp-devtools/core';
import { CLI_VERSION } from '../version.js';

/**
 * Server-level guidance shown to MCP clients on `initialize`. Helps the
 * connecting LLM understand the surface area without having to call
 * tools/list and read every description.
 */
const SERVER_INSTRUCTIONS = `acp-devtools exposes a local SQLite store of captured
Agent Client Protocol (ACP) sessions. ACP is the editor↔agent JSON-RPC
protocol used by Claude Code, Goose, Codex, and other IDE agents.

Every tool here is **read-only** — nothing in this server writes to the
database. Use it to investigate:

- a slow session (\`get_latency_stats\` returns per-method p50/p99/max
  plus auto-detected insights: hotspot, long-tail, outlier, busiest,
  errors)
- a misbehaving agent (\`find_spec_violations\` validates every frame
  against the ACP JSON schema)
- specific events (\`get_session_messages\` + \`get_message\` for the
  raw JSON-RPC payload)
- capture inventory (\`list_sessions\`, \`find_sessions_by_client\`)
- one-shot digest of a session (\`get_session_summary\` bundles
  metadata + latency stats + insights in one call — preferred over
  three separate calls when you just need an overview)
- a regression or A/B comparison between two sessions
  (\`diff_sessions\` aligns two captures and reports added / removed
  frames and field-level payload changes)

A typical investigation:
1. \`list_sessions\` to see what is captured
2. \`get_session_summary({session_id})\` for the headline numbers and
   auto-detected insights — start here when you don't know what's
   wrong yet
3. drill into a specific method or message with
   \`get_session_messages\` / \`get_message\` / \`get_paired\`

For common investigations the server also exposes canned prompts via
\`prompts/list\` — \`triage_slow_session\`, \`audit_spec_violations\`,
\`compare_clients\`. Each prompt seeds the right tool sequence.

Every tool declares an \`outputSchema\`, so results include both
\`content\` (text JSON) and \`structuredContent\` (typed object matching
the schema). Prefer \`structuredContent\` if your client supports it —
it avoids re-parsing the text payload.

Schema notes: sessions have a structured-metadata layer populated by the
\`backfill-metadata\` CLI; \`client_name\` / \`client_version\` /
\`client_platform\` may be null on freshly imported captures until that
command runs.

Redaction: every tool that returns frame contents OR derived views
of them (\`get_message\`, \`get_session_messages\`, \`search_messages\`,
\`get_session_metadata\`, \`get_session_summary\`, \`diff_sessions\`)
redacts auth headers and proxy tokens (\`Authorization\`,
\`X-Api-Key\`, JetBrains \`_meta.proxyConfig.proxies[*].proxy.headers.*\`,
etc). Sensitive fields appear as \`<REDACTED>\`. This is
unconditional; there is no opt-out flag, because the human owns the
share decision (use \`acp-devtools export <id> --raw\` on the CLI when
the export stays on your machine). \`search_messages\` indexes the
pre-redaction bytes so you can still find a frame by a token fragment,
but the returned \`raw\` is the redacted copy — do not quote the live
secret back to the user. \`diff_sessions\` operates on already-redacted
frames, so a token that rotated between two sessions shows up as equal
("<REDACTED>" on both sides) rather than as a change — this is
intentional, treating "token rotated" as a leaked side channel.`;

interface ToolMeta {
    readOnly?: boolean;
    idempotent?: boolean;
    title?: string;
}

function annotations(meta: ToolMeta) {
    return {
        title: meta.title,
        readOnlyHint: meta.readOnly ?? true,
        idempotentHint: meta.idempotent ?? true,
        openWorldHint: false,
    };
}

/**
 * Per the current MCP spec (LATEST_PROTOCOL_VERSION = 2025-11-25 in SDK
 * 1.29), when a tool declares an `outputSchema`, its result MUST
 * include a `structuredContent` field matching that schema. `content`
 * (text) is generated as the JSON.stringify of the structured payload
 * for clients that don't yet read structuredContent.
 *
 * Without outputSchema the LLM has to JSON.parse(text) and guess shape;
 * with it, the client gets a typed contract it can validate.
 */
function structuredResult<T extends Record<string, unknown>>(payload: T) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

// Reusable output-schema fragments.
const sessionSummaryRowSchema = z.object({
    id: z.number(),
    name: z.string().nullable(),
    agent_command: z.string().nullable(),
    started_at: z.number(),
    ended_at: z.number().nullable(),
    message_count: z.number(),
    client_name: z.string().nullable(),
    imported_at: z.number().nullable(),
    client_version: z.string().nullable(),
    client_platform: z.string().nullable(),
    agent_name: z.string().nullable(),
    agent_version: z.string().nullable(),
    protocol_version: z.number().nullable(),
    current_mode: z.string().nullable(),
    current_model: z.string().nullable(),
});

const insightSchema = z.object({
    kind: z.enum(['hotspot', 'long-tail', 'outlier', 'busiest', 'errors']),
    summary: z.string(),
    detail: z.string().optional(),
    methods: z.array(z.string()),
});

const perMethodSchema = z.object({
    method: z.string(),
    kind: z.enum(['request', 'notification']),
    count: z.number(),
    sampleSize: z.number(),
    p50: z.number().nullable(),
    p99: z.number().nullable(),
    max: z.number().nullable(),
    totalLatencyMs: z.number().nullable(),
    latencies: z.array(z.number()),
});

const messageSchema = z.object({
    seq: z.number(),
    timestamp: z.number(),
    direction: z.enum(['editor-to-agent', 'agent-to-editor']),
    kind: z.enum(['request', 'response', 'notification', 'error', 'unknown']),
    method: z.string().optional(),
    rpcId: z.union([z.string(), z.number()]).optional(),
    raw: z.string(),
    payload: z.unknown().nullable(),
    parseError: z.string().optional(),
});

const latencySchema = z.object({
    sampleSize: z.number(),
    p50: z.number().nullable(),
    p90: z.number().nullable(),
    p99: z.number().nullable(),
    max: z.number().nullable(),
});

interface McpOptions {
    db: string;
    name: string;
}

export function registerMcpCommand(program: Command): void {
    program
        .command('mcp')
        .description(
            'Run an MCP server over stdio that exposes saved captures as read-only tools. Wire into Claude Code via .claude/mcp_servers.json — then ask Claude to "find spec violations in last 10 sessions" or "compare p99 of WebStorm vs Zed".',
        )
        .option('--db <path>', 'captures database', defaultCapturesDbPath())
        .option('--name <name>', 'server name advertised in MCP handshake', 'acp-devtools')
        .action(async (opts: McpOptions) => {
            const server = buildMcpServer(opts);
            const transport = new StdioServerTransport();
            await server.connect(transport);
            // Keep alive until stdin closes — McpServer/Transport handle the rest.
        });
}

export function buildMcpServer(opts: McpOptions): McpServer {
    const server = new McpServer(
        {
            name: opts.name,
            version: CLI_VERSION,
        },
        {
            instructions: SERVER_INSTRUCTIONS,
        },
    );

    server.registerTool(
        'list_sessions',
        {
            description:
                'List saved ACP capture sessions in the local store, newest first. Each row includes session_id (use with other tools), client_name, agent_command, started_at/ended_at timestamps (Unix ms), message_count, and structured metadata columns (client_version, client_platform, agent_name, agent_version, protocol_version, current_mode, current_model). Use this as the first step to discover what is available before drilling into a specific session.',
            inputSchema: {
                limit: z
                    .number()
                    .int()
                    .positive()
                    .max(500)
                    .optional()
                    .describe('max sessions to return (default 50, max 500)'),
            },
            outputSchema: { sessions: z.array(sessionSummaryRowSchema) },
            annotations: annotations({ title: 'List saved sessions' }),
        },
        async ({ limit }) => {
            const rows = listSessionsSummary(opts.db, limit ?? 50);
            return structuredResult({ sessions: rows });
        },
    );

    server.registerTool(
        'find_sessions_by_client',
        {
            description:
                'Find saved sessions whose client name, version, or platform matches the given substring (case-insensitive). Use this to narrow scope to a specific editor — "WebStorm" returns JetBrains captures, "intellij" matches client_platform=intellij, "Zed" returns Zed captures. Returns the same row shape as list_sessions.',
            inputSchema: {
                client: z
                    .string()
                    .min(1)
                    .describe(
                        'case-insensitive substring matched against client_name / client_version / client_platform (e.g. "WebStorm", "intellij", "Zed")',
                    ),
                limit: z
                    .number()
                    .int()
                    .positive()
                    .max(500)
                    .optional()
                    .describe('max matching sessions to return (default 50)'),
            },
            outputSchema: { sessions: z.array(sessionSummaryRowSchema) },
            annotations: annotations({ title: 'Find sessions by client' }),
        },
        async ({ client, limit }) => {
            const rows = findSessionsByClient(opts.db, client, limit ?? 50);
            return structuredResult({ sessions: rows });
        },
    );

    server.registerTool(
        'get_session_metadata',
        {
            description:
                'Derive client/agent/protocol metadata for one session by replaying its `initialize` request and response, and aggregating set_mode / set_model / available_commands_update notifications. Returns: client info (name/title/version/platform), agent info, advertised capabilities on both sides (fs.readTextFile, terminal, prompt, loadSession…), current mode and model, and any JetBrains-specific _meta.proxyConfig extension. Same data as `acp-devtools session-info <id> --json`. Prefer get_session_summary if you also want latency stats.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions / find_sessions_by_client'),
            },
            outputSchema: {
                session_id: z.number(),
                metadata: z.unknown(),
            },
            annotations: annotations({ title: 'Get session metadata' }),
        },
        async ({ session_id }) => {
            // SECURITY: redact before metadata extraction so the returned
            // `extensions.jetbrainsProxyConfig` carries <REDACTED> headers.
            const messages = redactedReadMessages(opts.db, session_id);
            return structuredResult({
                session_id,
                metadata: extractSessionMetadata(messages) as unknown,
            });
        },
    );

    server.registerTool(
        'get_latency_stats',
        {
            description:
                'Per-method count + latency percentiles for one session: p50, p99, max, total wall time, plus sorted latency samples. Identical numbers to `acp-devtools stats <id> --by-method`. Also returns session-wide p50/p90/p99/max and auto-detected insights (hotspot/long-tail/outlier/busiest/errors) — start here when triaging a slow session.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions / find_sessions_by_client'),
            },
            outputSchema: {
                session_id: z.number(),
                perMethod: z.array(perMethodSchema),
                sessionLatency: latencySchema,
                insights: z.array(insightSchema),
            },
            annotations: annotations({ title: 'Get latency stats + insights' }),
        },
        async ({ session_id }) => {
            const messages = readMessages(opts.db, session_id);
            const perMethod = buildPerMethodStats(messages);
            const insights = buildPerformanceInsights(messages, perMethod);
            const pairs = buildPairIndex(messages);
            const latencies: number[] = [];
            for (const m of messages) {
                if (m.kind !== 'request') continue;
                const p = pairs.get(m.seq);
                if (p) latencies.push(p.latencyMs);
            }
            latencies.sort((a, b) => a - b);
            const sessionLatency = {
                sampleSize: latencies.length,
                p50: latencies.length ? percentile(latencies, 50) : null,
                p90: latencies.length ? percentile(latencies, 90) : null,
                p99: latencies.length ? percentile(latencies, 99) : null,
                max: latencies.length ? latencies[latencies.length - 1] : null,
            };
            return structuredResult({ session_id, perMethod, sessionLatency, insights });
        },
    );

    server.registerTool(
        'get_session_summary',
        {
            description:
                'One-call digest of a session: client/agent metadata + per-method latency + session-wide percentiles + auto-detected insights, in a single response. Prefer this over three separate calls to get_session_metadata / get_latency_stats / find_spec_violations when you just want a quick overview — saves round-trips and gives the same numbers.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions / find_sessions_by_client'),
            },
            outputSchema: {
                session_id: z.number(),
                metadata: z.unknown(),
                totals: z.object({
                    messages: z.number(),
                    direction: z.object({
                        editorToAgent: z.number(),
                        agentToEditor: z.number(),
                    }),
                    kind: z.object({
                        request: z.number(),
                        response: z.number(),
                        notification: z.number(),
                        error: z.number(),
                        unknown: z.number(),
                    }),
                }),
                latency: latencySchema,
                perMethod: z.array(perMethodSchema),
                insights: z.array(insightSchema),
            },
            annotations: annotations({ title: 'One-call session digest' }),
        },
        async ({ session_id }) => {
            // SECURITY: redact before any derived view (metadata bundled
            // into the summary would otherwise carry proxy_key in
            // extensions.jetbrainsProxyConfig). Latency / per-method stats
            // don't read field values so the redaction is transparent.
            const messages = redactedReadMessages(opts.db, session_id);
            const perMethod = buildPerMethodStats(messages);
            const insights = buildPerformanceInsights(messages, perMethod);
            const pairs = buildPairIndex(messages);
            const latencies: number[] = [];
            const directionCount = { editorToAgent: 0, agentToEditor: 0 };
            const kindCount = { request: 0, response: 0, notification: 0, error: 0, unknown: 0 };
            for (const m of messages) {
                if (m.kind === 'request') {
                    const p = pairs.get(m.seq);
                    if (p) latencies.push(p.latencyMs);
                }
                if (m.direction === 'editor-to-agent') directionCount.editorToAgent += 1;
                else directionCount.agentToEditor += 1;
                kindCount[m.kind] += 1;
            }
            latencies.sort((a, b) => a - b);
            return structuredResult({
                session_id,
                metadata: extractSessionMetadata(messages) as unknown,
                totals: {
                    messages: messages.length,
                    direction: directionCount,
                    kind: kindCount,
                },
                latency: {
                    sampleSize: latencies.length,
                    p50: latencies.length ? percentile(latencies, 50) : null,
                    p90: latencies.length ? percentile(latencies, 90) : null,
                    p99: latencies.length ? percentile(latencies, 99) : null,
                    max: latencies.length ? latencies[latencies.length - 1] : null,
                },
                perMethod,
                insights,
            });
        },
    );

    server.registerTool(
        'get_session_messages',
        {
            description:
                'Paginated, filtered slice of captured JSON-RPC frames from one session. Filterable by kind (request/response/notification/error/unknown), method substring (case-insensitive), and direction. Each returned frame includes seq (stable per-session id), timestamp (Unix ms), direction, kind, method, rpcId, raw bytes, parsed payload, and parseError if the frame failed to parse. Use offset+limit to paginate — `total` in the response is the size of the filtered set, not the page.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions'),
                offset: z.number().int().nonnegative().optional().describe('skip this many filtered rows (default 0)'),
                limit: z
                    .number()
                    .int()
                    .positive()
                    .max(500)
                    .optional()
                    .describe('max rows to return (default 100, hard cap 500)'),
                method: z
                    .string()
                    .optional()
                    .describe(
                        'case-insensitive substring match against frame.method (e.g. "session/" to get every session-scoped call)',
                    ),
                kind: z
                    .enum(['request', 'response', 'notification', 'error', 'unknown'])
                    .optional()
                    .describe('JSON-RPC frame kind. "unknown" covers parse-failed frames'),
                direction: z
                    .enum(['editor-to-agent', 'agent-to-editor'])
                    .optional()
                    .describe('flow direction'),
            },
            outputSchema: {
                session_id: z.number(),
                total: z.number(),
                offset: z.number(),
                returned: z.number(),
                messages: z.array(messageSchema),
            },
            annotations: annotations({ title: 'List session messages' }),
        },
        async ({ session_id, offset, limit, method, kind, direction }) => {
            const messages = readMessages(opts.db, session_id);
            const filtered = messages.filter((m) => {
                if (kind && m.kind !== kind) return false;
                if (direction && m.direction !== direction) return false;
                if (
                    method &&
                    (!m.method || !m.method.toLowerCase().includes(method.toLowerCase()))
                ) {
                    return false;
                }
                return true;
            });
            const total = filtered.length;
            const start = offset ?? 0;
            const end = Math.min(start + (limit ?? 100), total);
            // SECURITY: redact auth tokens before they reach the LLM. No
            // opt-out — the LLM cannot judge the user's share intent.
            return structuredResult({
                session_id,
                total,
                offset: start,
                returned: end - start,
                messages: filtered.slice(start, end).map((m) => redactMessage(m).redacted),
            });
        },
    );

    server.registerTool(
        'get_message',
        {
            description:
                'Fetch a single captured frame by (session_id, seq). Returns the full record: raw JSON bytes, parsed payload, parseError (if any), direction, kind, method, rpcId, timestamp. Use this after find_spec_violations / get_session_messages narrows you down to a specific seq.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions'),
                seq: z
                    .number()
                    .int()
                    .positive()
                    .describe('per-session sequence number from list_session_messages or find_spec_violations'),
            },
            outputSchema: {
                session_id: z.number(),
                message: messageSchema,
            },
            annotations: annotations({ title: 'Get one message' }),
        },
        async ({ session_id, seq }) => {
            const messages = readMessages(opts.db, session_id);
            const msg = messages.find((m) => m.seq === seq);
            if (!msg) {
                return errorResult(`session ${session_id} has no message #${seq}`);
            }
            // SECURITY: same redaction rule as get_session_messages.
            return structuredResult({ session_id, message: redactMessage(msg).redacted });
        },
    );

    server.registerTool(
        'get_paired',
        {
            description:
                'For a given JSON-RPC frame, return its request↔response partner — pass a request seq, get the response; pass a response seq, get the request. Includes latencyMs between the pair. Returns paired:null for orphan frames (request with no response, response with no matching id). Notifications and parse-failed frames have no pair.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions'),
                seq: z
                    .number()
                    .int()
                    .positive()
                    .describe('seq of either the request or the response'),
            },
            outputSchema: {
                session_id: z.number(),
                seq: z.number(),
                paired: z
                    .object({ pairSeq: z.number(), latencyMs: z.number() })
                    .nullable(),
            },
            annotations: annotations({ title: 'Get request↔response pair' }),
        },
        async ({ session_id, seq }) => {
            const messages = readMessages(opts.db, session_id);
            const pairs = buildPairIndex(messages);
            const info = pairs.get(seq);
            return structuredResult({ session_id, seq, paired: info ?? null });
        },
    );

    server.registerTool(
        'search_messages',
        {
            description:
                'Case-insensitive substring search across raw JSON bytes of every frame in a session. Returns the matching seq, method, and the raw frame so you can confirm the hit. Useful for tracking down a specific session id, file path, prompt text, or error message across a long capture. Searches the raw JSON-RPC envelope — JSON-escaped characters (\\n, \\") are present.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions'),
                query: z
                    .string()
                    .min(1)
                    .describe('case-insensitive substring to find in raw frame bytes'),
                limit: z
                    .number()
                    .int()
                    .positive()
                    .max(200)
                    .optional()
                    .describe('max matches to return (default 50)'),
            },
            outputSchema: {
                session_id: z.number(),
                query: z.string(),
                matches: z.array(
                    z.object({
                        seq: z.number(),
                        method: z.string().nullable(),
                        raw: z.string(),
                    }),
                ),
                total: z.number(),
            },
            annotations: annotations({ title: 'Search session messages' }),
        },
        async ({ session_id, query, limit }) => {
            const messages = readMessages(opts.db, session_id);
            const needle = query.toLowerCase();
            const matches: Array<{ seq: number; method: string | null; raw: string }> = [];
            for (const m of messages) {
                // SECURITY: match on the original raw (so a token fragment can
                // still locate its frame), but return the redacted raw so the
                // LLM can't quote the live secret back to the user.
                if (m.raw.toLowerCase().includes(needle)) {
                    const safe = redactMessage(m).redacted;
                    matches.push({ seq: m.seq, method: m.method ?? null, raw: safe.raw });
                    if (matches.length >= (limit ?? 50)) break;
                }
            }
            return structuredResult({ session_id, query, matches, total: matches.length });
        },
    );

    server.registerTool(
        'find_spec_violations',
        {
            description:
                'Validate every captured frame in a session against the ACP JSON schema (Draft 2020-12, ajv-compiled). Returns every offender with its seq, method, and per-error path + keyword + message. Schema-skipped frames (unknown methods, parse errors, generic envelopes) are not counted. Use the returned seq with get_message to inspect the offending raw payload. Start here when an agent is misbehaving but you don\'t yet know how.',
            inputSchema: {
                session_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('session id from list_sessions'),
            },
            outputSchema: {
                session_id: z.number(),
                checked: z.number(),
                // Each entry holds the raw ajv ErrorObject which has a
                // variable shape per keyword (data/schema/parentSchema get
                // added by some keywords, not others). Declare the known
                // fields, pass extras through unmodified.
                violations: z.array(
                    z
                        .object({
                            seq: z.number(),
                            method: z.string().nullable(),
                            errors: z.array(z.looseObject({
                                keyword: z.string(),
                                instancePath: z.string().optional(),
                                schemaPath: z.string().optional(),
                                message: z.string().optional(),
                            })),
                        })
                        .loose(),
                ),
            },
            annotations: annotations({ title: 'Validate session against ACP schema' }),
        },
        async ({ session_id }) => {
            const messages = readMessages(opts.db, session_id);
            const pairs = buildPairIndex(messages);
            const seqToMethod = new Map<number, string>();
            for (const m of messages) if (m.method) seqToMethod.set(m.seq, m.method);
            const violations: Array<{
                seq: number;
                method: string | null;
                errors: ReturnType<typeof validateAcpMessage>['errors'];
            }> = [];
            let checked = 0;
            for (const m of messages) {
                const pair = pairs.get(m.seq);
                const pairedMethod = pair ? seqToMethod.get(pair.pairSeq) : undefined;
                const validationOpts: Parameters<typeof validateAcpMessage>[1] = {};
                if (pairedMethod !== undefined) validationOpts.pairedMethod = pairedMethod;
                const result = validateAcpMessage(m, validationOpts);
                if (result.skipped) continue;
                checked += 1;
                if (!result.valid) {
                    violations.push({
                        seq: m.seq,
                        method: m.method ?? pairedMethod ?? null,
                        errors: result.errors,
                    });
                }
            }
            return structuredResult({ session_id, checked, violations });
        },
    );

    server.registerTool(
        'diff_sessions',
        {
            description:
                'Align two saved sessions and report what changed between them, across three layers. (1) `metadata`: high-signal differences in client/agent identity, capability matrices, protocol version, and runtime mode/model (JetBrains proxyConfig is excluded as volatile). (2) `perMethod`: per-method latency deltas (p50/p99/max and count, b−a). (3) `rows`: frame-level alignment via an LCS over (direction, kind, method) — matched frames compared field-by-field on the payload (volatile rpcId ignored), each row equal/changed/added/removed. A is the baseline, B is the new side. Use this for "worked yesterday, broke today" regressions and A/B comparisons of two agents on the same prompt — start with `metadata` and `perMethod`, which (unlike raw frames) do not drown in per-run noise. Equal frame rows are omitted unless include_equal is true; get_message(session_id, seq) with a row\'s a_seq/b_seq fetches the raw payload.',
            inputSchema: {
                session_a: z
                    .number()
                    .int()
                    .positive()
                    .describe('baseline session id (left side)'),
                session_b: z
                    .number()
                    .int()
                    .positive()
                    .describe('new session id (right side)'),
                include_equal: z
                    .boolean()
                    .optional()
                    .describe('include unchanged rows in the response (default false)'),
            },
            outputSchema: {
                session_a: z.number(),
                session_b: z.number(),
                summary: z.object({
                    equal: z.number(),
                    changed: z.number(),
                    added: z.number(),
                    removed: z.number(),
                    total: z.number(),
                }),
                metadata: z.array(
                    z.object({
                        path: z.string(),
                        kind: z.enum(['add', 'remove', 'change']),
                        a: z.unknown().optional(),
                        b: z.unknown().optional(),
                    }),
                ),
                perMethod: z.array(
                    z.object({
                        method: z.string(),
                        kind: z.enum(['request', 'notification']),
                        a: perMethodSchema.nullable(),
                        b: perMethodSchema.nullable(),
                        countDelta: z.number(),
                        p50Delta: z.number().nullable(),
                        p99Delta: z.number().nullable(),
                        maxDelta: z.number().nullable(),
                    }),
                ),
                rows: z.array(
                    z.object({
                        op: z.enum(['equal', 'changed', 'added', 'removed']),
                        kind: z.enum(['request', 'response', 'notification', 'error', 'unknown']),
                        method: z.string().nullable(),
                        direction: z.enum(['editor-to-agent', 'agent-to-editor']),
                        a_seq: z.number().nullable(),
                        b_seq: z.number().nullable(),
                        changes: z.array(
                            z.object({
                                path: z.string(),
                                kind: z.enum(['add', 'remove', 'change']),
                                a: z.unknown().optional(),
                                b: z.unknown().optional(),
                            }),
                        ),
                    }),
                ),
            },
            annotations: annotations({ title: 'Diff two sessions' }),
        },
        async ({ session_a, session_b, include_equal }) => {
            // SECURITY: redact both sides before diffing. Otherwise
            // JsonChange.a/b in `rows[].changes[]` carry live token values
            // for any field that differed (e.g. proxy_key rotated between
            // sessions). After redaction, two different tokens both
            // collapse to "<REDACTED>" — the diff loses the "this field
            // changed" signal for the redacted slot, which is the
            // correct trade-off (informing the LLM that a token rotated
            // is itself a side channel).
            const a = redactedReadMessages(opts.db, session_a);
            const b = redactedReadMessages(opts.db, session_b);
            const diff = buildSessionDiff(a, b);
            const meta = buildMetadataDiff(a, b);
            const perMethod = buildMethodStatsDiff(a, b);
            const rows = diff.rows
                .filter((r) => include_equal || r.op !== 'equal')
                .map((r) => {
                    const ref = r.a ?? r.b!;
                    return {
                        op: r.op,
                        kind: ref.kind,
                        method: r.signature.split('|')[2] || null,
                        direction: ref.direction,
                        a_seq: r.a ? r.a.seq : null,
                        b_seq: r.b ? r.b.seq : null,
                        changes: r.changes,
                    };
                });
            return structuredResult({
                session_a,
                session_b,
                summary: diff.summary,
                metadata: meta.changes,
                perMethod,
                rows,
            });
        },
    );

    registerPrompts(server);

    return server;
}

/**
 * Server-side prompt templates the user can invoke from their MCP client
 * (e.g. Claude Desktop's slash menu). A prompt returns a list of
 * `messages` that seed the conversation; the LLM then executes the
 * implied investigation using the read-only tools above.
 *
 * Kept as canned playbooks so the user doesn't have to recite the
 * "list_sessions → get_session_summary → drill into seq" flow every
 * time.
 */
function registerPrompts(server: McpServer): void {
    server.registerPrompt(
        'triage_slow_session',
        {
            title: 'Triage a slow ACP session',
            description:
                'Investigate latency in one session: pull a summary, identify the hotspot method, drill into the slowest call. Provide a session_id to scope; omit to triage the most recent session.',
            argsSchema: {
                session_id: z
                    .string()
                    .optional()
                    .describe(
                        'session id to triage. Omit to use list_sessions and pick the newest one',
                    ),
            },
        },
        ({ session_id }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `Triage ACP session ${session_id ?? '(newest from list_sessions)'} for latency problems.\n\n` +
                            `Steps:\n` +
                            `1. ${session_id ? `Call get_session_summary({session_id: ${session_id}})` : 'Call list_sessions({limit: 1}) and use that id with get_session_summary'} to get headline numbers and auto-detected insights.\n` +
                            `2. If insights contain a HOTSPOT or LONG-TAIL, drill into that method:\n` +
                            `   - get_session_messages({session_id, method: "<the slow method>", kind: "request", limit: 20})\n` +
                            `   - pick the request with the largest paired latency and call get_paired({session_id, seq})\n` +
                            `   - get_message({session_id, seq: <the request seq>}) and get_message({session_id, seq: <the paired seq>}) for the raw payloads\n` +
                            `3. Summarize: what was slow (method, p50, p99, max), the likely cause (large payload, agent stall, etc.), and the seq numbers I should look at in the inspector UI.\n\n` +
                            `Be concrete — cite numbers and seqs, not adjectives.`,
                    },
                },
            ],
        }),
    );

    server.registerPrompt(
        'audit_spec_violations',
        {
            title: 'Audit recent sessions for ACP spec violations',
            description:
                'Run find_spec_violations on the most recent sessions and summarize the most common violation patterns across them.',
            argsSchema: {
                limit: z
                    .string()
                    .optional()
                    .describe('how many recent sessions to audit (default 10)'),
            },
        },
        ({ limit }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `Audit the last ${limit ?? '10'} ACP sessions for spec violations.\n\n` +
                            `Steps:\n` +
                            `1. Call list_sessions({limit: ${limit ?? 10}}) to get the recent session ids.\n` +
                            `2. For each, call find_spec_violations({session_id}).\n` +
                            `3. Group violations by (method, errors[0].keyword, errors[0].instancePath) — the same path/keyword pair across sessions is the interesting signal.\n` +
                            `4. Report: top 3 violation patterns by frequency, the methods they hit, and one example raw payload per pattern (use get_message for the offending seq).\n\n` +
                            `Skip sessions with 0 violations from the report.`,
                    },
                },
            ],
        }),
    );

    server.registerPrompt(
        'compare_clients',
        {
            title: 'Compare latency between two ACP clients',
            description:
                'Compare per-method latency stats between two clients (e.g. WebStorm vs Zed). Finds typical sessions for each, runs get_latency_stats, and surfaces the methods where one client is significantly slower.',
            argsSchema: {
                client_a: z
                    .string()
                    .describe('first client substring (e.g. "WebStorm")'),
                client_b: z
                    .string()
                    .describe('second client substring (e.g. "Zed")'),
            },
        },
        ({ client_a, client_b }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `Compare ACP latency between ${client_a} and ${client_b}.\n\n` +
                            `Steps:\n` +
                            `1. Call find_sessions_by_client({client: "${client_a}"}) and find_sessions_by_client({client: "${client_b}"}). For each side, pick the session with the largest message_count (most representative sample).\n` +
                            `2. For each picked session, call get_latency_stats({session_id}).\n` +
                            `3. Build a table: method × ${client_a} p50/p99 × ${client_b} p50/p99 × ratio. Sort by ratio descending.\n` +
                            `4. Highlight rows where one side is ≥2× the other and the sample size on both sides is ≥5.\n\n` +
                            `Cite the chosen session ids and their message counts so I can replicate in the inspector.`,
                    },
                },
            ],
        }),
    );
}

// SECURITY: every helper that derives output for MCP consumers from
// captured messages MUST pull through redactedReadMessages, not
// readMessages, unless it already redacts at output (get_session_messages,
// get_message, search_messages do this per-call to preserve search-on-
// original semantics). All derived views — metadata extraction,
// session-diff, session-summary — operate on already-redacted frames so
// that derived fields (JsonChange.a/b, extensions.jetbrainsProxyConfig
// headers, …) can never carry a live proxy_key into the LLM context.
function redactedReadMessages(dbPath: string, sessionId: number): CapturedMessage[] {
    return readMessages(dbPath, sessionId).map((m) => redactMessage(m).redacted);
}

function readMessages(dbPath: string, sessionId: number): CapturedMessage[] {
    const db = openDatabase(dbPath);
    try {
        const session = Session.load(db, sessionId);
        const out: CapturedMessage[] = [];
        for (const m of session.messages()) out.push(m);
        return out;
    } finally {
        db.close();
    }
}

function errorResult(message: string) {
    return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
    };
}
