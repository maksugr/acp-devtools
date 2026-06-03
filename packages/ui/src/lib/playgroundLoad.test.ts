import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PLAYGROUND_URL_ALLOWLIST,
    fetchPlaygroundExport,
    isAllowedPlaygroundUrl,
    parseExportSource,
} from './playgroundLoad';

const validExport = {
    version: 1,
    exportedAt: 1_700_000_000_000,
    tool: { name: 'acp-devtools', version: '0.1.0' },
    session: {
        id: 1,
        name: null,
        agentCommand: null,
        clientName: null,
        startedAt: 1_700_000_000_000,
        endedAt: null,
    },
    messages: [],
};

describe('parseExportSource', () => {
    it('returns ok for a valid SessionExport JSON', () => {
        const r = parseExportSource(JSON.stringify(validExport));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.export.session.id).toBe(1);
    });

    it('returns a human-readable error for invalid JSON', () => {
        const r = parseExportSource('{not json');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/invalid JSON/i);
    });

    it('returns an error when version is unsupported', () => {
        const r = parseExportSource(JSON.stringify({ ...validExport, version: 999 }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/version/);
    });
});

describe('isAllowedPlaygroundUrl', () => {
    it.each([
        'https://raw.githubusercontent.com/user/repo/main/file.json',
        'https://gist.githubusercontent.com/user/abc/raw/session.json',
    ])('allows %s', (url) => {
        expect(isAllowedPlaygroundUrl(url)).toBe(true);
    });

    it.each([
        'https://example.com/anything.json',
        'http://raw.githubusercontent.com/x/y/main/z.json', // http
        'https://github.com/user/repo/raw/main/x.json', // wrong host
        'file:///etc/passwd',
        'javascript:alert(1)',
        'not a url',
        '',
    ])('rejects %s', (url) => {
        expect(isAllowedPlaygroundUrl(url)).toBe(false);
    });

    it('exposes the allowlist so docs/UI can reference it', () => {
        expect(PLAYGROUND_URL_ALLOWLIST).toContain('raw.githubusercontent.com');
        expect(PLAYGROUND_URL_ALLOWLIST).toContain('gist.githubusercontent.com');
    });
});

describe('fetchPlaygroundExport', () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        globalThis.fetch = vi.fn();
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('rejects a disallowed host before issuing the request', async () => {
        const r = await fetchPlaygroundExport('https://example.com/x.json');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/allowlist/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns the parsed export on a successful fetch from an allowed host', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(validExport),
        } as Response);

        const r = await fetchPlaygroundExport(
            'https://raw.githubusercontent.com/user/repo/main/session.json',
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.export.session.id).toBe(1);
    });

    it('reports network failures', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('network down'),
        );
        const r = await fetchPlaygroundExport(
            'https://raw.githubusercontent.com/user/repo/main/x.json',
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/network down/);
    });

    it('reports non-2xx HTTP responses', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: async () => '',
        } as Response);
        const r = await fetchPlaygroundExport(
            'https://gist.githubusercontent.com/user/abc/raw/missing.json',
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/404/);
    });

    it('reports parse errors after a successful HTTP response', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => '{not json',
        } as Response);
        const r = await fetchPlaygroundExport(
            'https://raw.githubusercontent.com/user/repo/main/x.json',
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/invalid JSON/i);
    });
});
