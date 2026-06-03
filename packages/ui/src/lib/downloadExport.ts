import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';
import { exportSessionFromParts, serializeExport } from '@acp-devtools/core/storage/export';
import { redactSessionExport } from '@acp-devtools/core/storage/redact';

const UI_TOOL = { name: 'acp-devtools-ui', version: '0.2.0' };

/**
 * Build a filesystem-safe filename for an exported session.
 * Examples: `acp-session-21-2026-05-27T18-34-06.json`,
 *           `acp-session-live-2026-05-27T18-34-06.json`.
 */
export function exportFilename(session: SessionRecord, now: number = Date.now()): string {
    const id = session.id > 0 ? String(session.id) : 'live';
    const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `acp-session-${id}-${stamp}.json`;
}

// SECURITY: every UI export is unconditionally redacted. The CLI
// (`acp-devtools export --raw`) is the only path that produces an
// un-redacted JSON — this is a deliberate design rule (see README
// "Design rules"). Do not add a `raw` parameter here.
export function buildExportJson(
    session: SessionRecord,
    messages: CapturedMessage[],
    now: number = Date.now(),
): string {
    const exp = exportSessionFromParts(session, messages, {
        tool: UI_TOOL,
        exportedAt: now,
    });
    const { export: redacted } = redactSessionExport(exp);
    return serializeExport(redacted);
}

/**
 * Trigger a browser download for a session export. Uses an off-DOM anchor +
 * `URL.createObjectURL` so it works in every modern browser without a server
 * round-trip. Auth headers and proxy tokens are redacted on the way out;
 * `fs/read_text_file` contents and prompts are NOT (no reliable heuristic
 * for "is this proprietary"), so the caller still warns the user about
 * user-content sensitivity before sharing.
 */
export function downloadSessionExport(
    session: SessionRecord,
    messages: CapturedMessage[],
    now: number = Date.now(),
): void {
    const json = buildExportJson(session, messages, now);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(session, now);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
