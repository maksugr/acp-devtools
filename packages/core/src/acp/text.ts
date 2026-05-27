import type { CapturedMessage } from './types.js';

interface PromptBlock {
    type?: string;
    text?: string;
}

interface UpdateContent {
    text?: string;
}

interface SessionUpdateParams {
    update?: {
        sessionUpdate?: string;
        content?: UpdateContent;
        text?: string;
    };
}

interface SessionPromptParams {
    prompt?: PromptBlock[];
}

/**
 * Pull a short human-readable preview out of an ACP message — used by both
 * the inspector timeline (next to the method name) and the CLI's `inspect`
 * table's PREVIEW column.
 *
 * Returns null when nothing meaningful can be extracted. Recognised shapes:
 * - `session/prompt` → joined text of all `params.prompt[].text` blocks of
 *   type `text`. Image / audio blocks contribute nothing.
 * - `session/update` (notification) → `params.update.content.text`, falling
 *   back to `params.update.text` when the content shape is absent (older
 *   agents).
 */
export function extractTextPreview(m: CapturedMessage): string | null {
    if (!m.payload || typeof m.payload !== 'object') return null;
    const params = (m.payload as { params?: unknown }).params;
    if (!params || typeof params !== 'object') return null;

    if (m.method === 'session/prompt') {
        const blocks = (params as SessionPromptParams).prompt;
        if (!Array.isArray(blocks)) return null;
        const parts: string[] = [];
        for (const block of blocks) {
            if (block?.type === 'text' && typeof block.text === 'string') {
                parts.push(block.text);
            }
        }
        const joined = parts.join(' ').trim();
        return joined.length > 0 ? joined : null;
    }

    if (m.method === 'session/update') {
        const update = (params as SessionUpdateParams).update;
        if (!update) return null;
        const text = update.content?.text ?? update.text;
        if (typeof text === 'string' && text.length > 0) return text;
        return null;
    }

    return null;
}

export function isUserPrompt(m: CapturedMessage): boolean {
    return m.method === 'session/prompt' && m.kind === 'request';
}
