/**
 * True when the bundle was built with `VITE_PLAYGROUND=1` — the static
 * "drop your export here" mode that gets deployed to GitHub Pages.
 *
 * In playground mode:
 * - discovery polling (`/api/active`, `/api/sessions`) is disabled — there is
 *   no backend to call
 * - the live WS connect is skipped
 * - the empty state shows a file-drop / `?url=` entry instead of the IDE setup
 *   snippets
 *
 * Exposed as a function (not a const) so tests can stub `import.meta.env`.
 */
export function isPlaygroundMode(): boolean {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.VITE_PLAYGROUND === '1';
}
