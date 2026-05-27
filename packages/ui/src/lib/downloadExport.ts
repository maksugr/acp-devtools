import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';
import { exportSessionFromParts, serializeExport } from '@acp-devtools/core/storage/export';

const UI_TOOL = { name: 'acp-devtools-ui', version: '0.1.0' };

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

export function buildExportJson(
    session: SessionRecord,
    messages: CapturedMessage[],
    now: number = Date.now(),
): string {
    const exp = exportSessionFromParts(session, messages, {
        tool: UI_TOOL,
        exportedAt: now,
    });
    return serializeExport(exp);
}

/**
 * Trigger a browser download for a session export. Uses an off-DOM anchor +
 * `URL.createObjectURL` so it works in every modern browser without a server
 * round-trip. The export contains every captured message — caller is
 * responsible for warning the user if the data is sensitive.
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
