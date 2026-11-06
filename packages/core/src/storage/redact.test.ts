import { describe, expect, it } from 'vitest';
import { redactMessage, redactSessionExport, REDACTED_PLACEHOLDER } from './redact.js';
import type { CapturedMessage } from '../acp/types.js';
import type { SessionExport } from './export.js';

const baseMsg = (overrides: Partial<CapturedMessage> = {}): CapturedMessage => ({
    seq: 1,
    timestamp: 1_700_000_000_000,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: 1,
    raw: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ...overrides,
});

describe('redactMessage', () => {
    it('redacts WebStorm _meta.proxyConfig.proxies[].proxy.headers.proxy_key', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: 1,
                _meta: {
                    proxyConfig: {
                        proxies: [
                            {
                                apiType: { provider: 'anthropic' },
                                proxy: {
                                    url: 'http://127.0.0.1:50001',
                                    headers: { proxy_key: 'real-token-aaaa-bbbb' },
                                },
                            },
                            {
                                apiType: { provider: 'openai' },
                                proxy: {
                                    url: 'http://127.0.0.1:50000',
                                    headers: { proxy_key: 'real-token-cccc-dddd' },
                                },
                            },
                        ],
                    },
                },
            },
        };
        const msg = baseMsg({ payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(2);
        const p = redacted.payload as typeof payload;
        expect(p.params._meta.proxyConfig.proxies[0].proxy.headers.proxy_key).toBe(
            REDACTED_PLACEHOLDER,
        );
        expect(p.params._meta.proxyConfig.proxies[1].proxy.headers.proxy_key).toBe(
            REDACTED_PLACEHOLDER,
        );
        expect(redacted.raw).not.toContain('real-token-aaaa-bbbb');
        expect(redacted.raw).not.toContain('real-token-cccc-dddd');
        expect(redacted.raw).toContain(REDACTED_PLACEHOLDER);
    });

    it('redacts Authorization header anywhere in the tree', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 2,
            method: 'fs/read_text_file',
            params: {
                someConfig: { headers: { Authorization: 'Bearer sk-leak-aaaa' } },
            },
        };
        const msg = baseMsg({ seq: 2, rpcId: 2, payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(1);
        expect(redacted.raw).not.toContain('Bearer sk-leak-aaaa');
        expect(redacted.raw).toContain(REDACTED_PLACEHOLDER);
    });

    it('matches header names case-insensitively', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 3,
            method: 'x',
            params: { h: { AUTHORIZATION: 'tok', 'X-Api-Key': 'tok2' } },
        };
        const msg = baseMsg({ seq: 3, rpcId: 3, payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);
        expect(count).toBe(2);
        expect((redacted.payload as typeof payload).params.h.AUTHORIZATION).toBe(
            REDACTED_PLACEHOLDER,
        );
        expect((redacted.payload as typeof payload).params.h['X-Api-Key']).toBe(
            REDACTED_PLACEHOLDER,
        );
    });

    it('redacts unknown header names INSIDE proxyConfig headers blocks', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 4,
            method: 'initialize',
            params: {
                _meta: {
                    proxyConfig: {
                        proxies: [
                            {
                                proxy: {
                                    url: 'http://127.0.0.1:50001',
                                    headers: {
                                        'x-new-jetbrains-token': 'future-leak',
                                        'x-trace-id': 'public-ok',
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        };
        const msg = baseMsg({ seq: 4, rpcId: 4, payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);
        expect(count).toBe(2);
        const headers = (redacted.payload as typeof payload).params._meta.proxyConfig.proxies[0]
            .proxy.headers;
        expect(headers['x-new-jetbrains-token']).toBe(REDACTED_PLACEHOLDER);
        expect(headers['x-trace-id']).toBe(REDACTED_PLACEHOLDER);
    });

    it('returns the original object reference when nothing was redacted', () => {
        const msg = baseMsg();
        const { redacted, count } = redactMessage(msg);
        expect(count).toBe(0);
        expect(redacted).toBe(msg);
    });

    it('leaves parse-error messages (payload null) alone', () => {
        const msg = baseMsg({
            kind: 'unknown',
            payload: null,
            parseError: 'invalid JSON',
            raw: 'Authorization: leaked-but-unparseable',
        });
        const { redacted, count } = redactMessage(msg);
        expect(count).toBe(0);
        expect(redacted).toBe(msg);
        expect(redacted.raw).toContain('leaked-but-unparseable');
    });

    it('does not redact non-string values with sensitive key names', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 5,
            method: 'x',
            params: { Authorization: 12345, headers: { api_key: null } },
        };
        const msg = baseMsg({ seq: 5, rpcId: 5, payload, raw: JSON.stringify(payload) });
        const { count } = redactMessage(msg);
        expect(count).toBe(0);
    });

    it('rewrites raw so the secret never appears in either field', () => {
        const secret = 'super-secret-token-xyz';
        const payload = {
            jsonrpc: '2.0' as const,
            id: 6,
            method: 'x',
            params: { headers: { Authorization: secret } },
        };
        const msg = baseMsg({ seq: 6, rpcId: 6, payload, raw: JSON.stringify(payload) });

        const { redacted } = redactMessage(msg);
        expect(redacted.raw).not.toContain(secret);
        expect(JSON.stringify(redacted.payload)).not.toContain(secret);
    });
});

describe('redactMessage — ACP name/value credential lists', () => {
    // Spec shapes: McpServerHttp.headers is HttpHeader[], McpServerStdio.env is
    // EnvVariable[] — both `{ name, value }` lists, not header maps.
    const sessionNew = () => ({
        jsonrpc: '2.0' as const,
        id: 7,
        method: 'session/new',
        params: {
            cwd: '/repo',
            mcpServers: [
                {
                    type: 'http',
                    name: 'github',
                    url: 'https://api.githubcopilot.com/mcp/',
                    headers: [
                        { name: 'Authorization', value: 'Bearer ghp_header_secret' },
                        { name: 'X-MCP-Toolsets', value: 'repos,issues' },
                    ],
                },
                {
                    name: 'postgres',
                    command: 'npx',
                    args: ['-y', 'pg-mcp'],
                    env: [
                        { name: 'GITHUB_TOKEN', value: 'ghp_env_secret' },
                        { name: 'DATABASE_URL', value: 'postgres://u:pw_secret@db/app' },
                    ],
                },
            ],
        },
    });

    it('masks every header and env value of MCP servers in session/new, keeping names', () => {
        const payload = sessionNew();
        const msg = baseMsg({
            seq: 7,
            rpcId: 7,
            method: 'session/new',
            payload,
            raw: JSON.stringify(payload),
        });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(4);
        for (const secret of ['ghp_header_secret', 'repos,issues', 'ghp_env_secret', 'pw_secret']) {
            expect(redacted.raw).not.toContain(secret);
            expect(JSON.stringify(redacted.payload)).not.toContain(secret);
        }
        const [http, stdio] = (redacted.payload as ReturnType<typeof sessionNew>).params.mcpServers;
        expect(http.headers).toEqual([
            { name: 'Authorization', value: REDACTED_PLACEHOLDER },
            { name: 'X-MCP-Toolsets', value: REDACTED_PLACEHOLDER },
        ]);
        expect(stdio.env).toEqual([
            { name: 'GITHUB_TOKEN', value: REDACTED_PLACEHOLDER },
            { name: 'DATABASE_URL', value: REDACTED_PLACEHOLDER },
        ]);
        expect(http.url).toBe('https://api.githubcopilot.com/mcp/');
        expect(stdio.args).toEqual(['-y', 'pg-mcp']);
    });

    it('masks terminal-auth env maps in the initialize response', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 0,
            result: {
                protocolVersion: 1,
                authMethods: [
                    {
                        type: 'terminal',
                        id: 'login',
                        name: 'Log in',
                        args: ['--login'],
                        env: { ACME_API_KEY: 'sk-terminal-secret', ACME_REGION: 'eu' },
                    },
                ],
            },
        };
        const msg = baseMsg({
            direction: 'agent-to-editor',
            kind: 'response',
            method: undefined,
            rpcId: 0,
            payload,
            raw: JSON.stringify(payload),
        });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(2);
        expect(redacted.raw).not.toContain('sk-terminal-secret');
        expect((redacted.payload as typeof payload).result.authMethods[0].env).toEqual({
            ACME_API_KEY: REDACTED_PLACEHOLDER,
            ACME_REGION: REDACTED_PLACEHOLDER,
        });
    });

    it('masks a sensitive-named { name, value } pair anywhere in the tree', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 8,
            method: 'x',
            params: { _meta: { extra: [{ name: 'X-Api-Key', value: 'k-anywhere', note: 'n' }] } },
        };
        const msg = baseMsg({ seq: 8, rpcId: 8, payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(1);
        expect((redacted.payload as typeof payload).params._meta.extra[0]).toEqual({
            name: 'X-Api-Key',
            value: REDACTED_PLACEHOLDER,
            note: 'n',
        });
    });

    it('leaves non-credential { name, value } pairs alone', () => {
        const payload = {
            jsonrpc: '2.0' as const,
            id: 9,
            method: 'session/update',
            params: { options: [{ name: 'mode', value: 'ask' }] },
        };
        const msg = baseMsg({ seq: 9, rpcId: 9, payload, raw: JSON.stringify(payload) });

        const { redacted, count } = redactMessage(msg);

        expect(count).toBe(0);
        expect(redacted).toBe(msg);
    });

    it('is idempotent: re-redacting an already redacted frame counts nothing', () => {
        const payload = sessionNew();
        const first = redactMessage(
            baseMsg({ seq: 7, rpcId: 7, payload, raw: JSON.stringify(payload) }),
        ).redacted;

        const { redacted, count } = redactMessage(first);

        expect(count).toBe(0);
        expect(redacted.raw).toBe(first.raw);
    });
});

describe('redactSessionExport', () => {
    const buildExport = (messages: CapturedMessage[]): SessionExport => ({
        version: 1,
        exportedAt: 1_700_000_000_000,
        tool: { name: 'test', version: '1.0.0' },
        session: {
            id: 1,
            name: null,
            agentCommand: null,
            clientName: null,
            startedAt: 1_700_000_000_000,
            endedAt: null,
        },
        messages,
    });

    it('counts redactions across all messages', () => {
        const exp = buildExport([
            baseMsg({
                seq: 1,
                payload: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        _meta: {
                            proxyConfig: {
                                proxies: [
                                    { proxy: { url: 'x', headers: { proxy_key: 'a' } } },
                                    { proxy: { url: 'y', headers: { proxy_key: 'b' } } },
                                ],
                            },
                        },
                    },
                },
            }),
            baseMsg({
                seq: 2,
                payload: {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'fs/read_text_file',
                    params: { h: { Authorization: 'tok' } },
                },
            }),
            baseMsg({
                seq: 3,
                payload: { jsonrpc: '2.0', id: 3, method: 'session/prompt', params: {} },
            }),
        ]);

        const result = redactSessionExport(exp);
        expect(result.fieldsRedacted).toBe(3);
        expect(result.messagesAffected).toBe(2);
        expect(result.export).not.toBe(exp);
        expect(result.export.messages).toHaveLength(3);
        expect(result.export.messages[2]).toBe(exp.messages[2]);
    });

    it('returns input unchanged when nothing was redacted', () => {
        const exp = buildExport([baseMsg()]);
        const result = redactSessionExport(exp);
        expect(result.fieldsRedacted).toBe(0);
        expect(result.messagesAffected).toBe(0);
        expect(result.export).toBe(exp);
    });
});
