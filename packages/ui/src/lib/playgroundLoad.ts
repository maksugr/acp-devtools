import { parseExport, type SessionExport } from '@acp-devtools/core/storage/export';

export const PLAYGROUND_URL_ALLOWLIST: ReadonlyArray<string> = [
    'raw.githubusercontent.com',
    'gist.githubusercontent.com',
];

export type LoadResult =
    | { ok: true; export: SessionExport }
    | { ok: false; error: string };

export function parseExportSource(text: string): LoadResult {
    try {
        const exp = parseExport(text);
        return { ok: true, export: exp };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function isAllowedPlaygroundUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    return PLAYGROUND_URL_ALLOWLIST.includes(parsed.host);
}

export async function fetchPlaygroundExport(url: string): Promise<LoadResult> {
    if (!isAllowedPlaygroundUrl(url)) {
        return {
            ok: false,
            error: `host not in playground allowlist (${PLAYGROUND_URL_ALLOWLIST.join(', ')})`,
        };
    }
    let response: Response;
    try {
        response = await fetch(url, { redirect: 'follow' });
    } catch (err) {
        return { ok: false, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const text = await response.text();
    return parseExportSource(text);
}
