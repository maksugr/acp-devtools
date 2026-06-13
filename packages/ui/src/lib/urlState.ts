import type { CapturedMessage } from '@acp-devtools/core';
import { ALL_DIRECTIONS, ALL_KINDS } from '../store/messagesStore';
import type { DetailTab, Filters } from '../store/messagesStore';

const DIR_CODE: Record<CapturedMessage['direction'], string> = {
    'editor-to-agent': 'out',
    'agent-to-editor': 'in',
};
const DIR_FROM_CODE: Record<string, CapturedMessage['direction']> = {
    out: 'editor-to-agent',
    in: 'agent-to-editor',
};

const KIND_CODE: Record<CapturedMessage['kind'], string> = {
    request: 'req',
    response: 'rsp',
    notification: 'ntf',
    error: 'err',
    unknown: 'unk',
};
const KIND_FROM_CODE: Record<string, CapturedMessage['kind']> = {
    req: 'request',
    rsp: 'response',
    ntf: 'notification',
    err: 'error',
    unk: 'unknown',
};

const VALID_TABS: DetailTab[] = ['tree', 'raw', 'meta'];

export interface UrlState {
    filters: Partial<Filters>;
    selectedSeq: number | null;
    detailTab: DetailTab | null;
    playhead: number | null;
    captureUrl: string | null;
}

export function parseUrlState(search: string): UrlState {
    const p = new URLSearchParams(search);
    const filters: Partial<Filters> = {};

    const dir = p.get('dir');
    if (dir !== null) {
        const codes = dir.split(',').map((c) => c.trim()).filter(Boolean);
        const dirs = codes
            .map((c) => DIR_FROM_CODE[c])
            .filter((v): v is CapturedMessage['direction'] => v !== undefined);
        if (dirs.length > 0) filters.directions = new Set(dirs);
    }

    const kind = p.get('kind');
    if (kind !== null) {
        const codes = kind.split(',').map((c) => c.trim()).filter(Boolean);
        const kinds = codes
            .map((c) => KIND_FROM_CODE[c])
            .filter((v): v is CapturedMessage['kind'] => v !== undefined);
        if (kinds.length > 0) filters.kinds = new Set(kinds);
    }

    if (p.get('streams') === '0') filters.showStreams = false;
    const q = p.get('q');
    if (q !== null) filters.search = q;

    const seqRaw = p.get('seq');
    const selectedSeq = seqRaw !== null && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;

    const tabRaw = p.get('tab');
    const detailTab =
        tabRaw !== null && (VALID_TABS as string[]).includes(tabRaw)
            ? (tabRaw as DetailTab)
            : null;

    const playRaw = p.get('play');
    const playhead =
        playRaw !== null && /^\d+$/.test(playRaw) ? Number(playRaw) : null;

    const captureUrl = p.get('ws');

    return { filters, selectedSeq, detailTab, playhead, captureUrl };
}

export interface WriteState {
    filters: Filters;
    selectedSeq: number | null;
    detailTab: DetailTab;
    playhead: number | null;
    captureUrl: string | null;
}

const OWNED_KEYS = ['ws', 'dir', 'kind', 'streams', 'q', 'seq', 'tab', 'play'];

/**
 * Rewrite the query string to reflect the given UI state. Preserves any
 * params the URL state subsystem does not own; uses `replaceState` so we
 * never grow the browser back-stack while the user toggles things.
 * Carries the existing `history.state` through — drawers (perf / info)
 * tag their pushed history entries with a state marker that this routine
 * must not clobber when ephemeral URL params change.
 */
export function writeUrlState(state: WriteState): void {
    const p = new URLSearchParams(window.location.search);
    for (const k of OWNED_KEYS) p.delete(k);

    if (state.captureUrl) p.set('ws', state.captureUrl);

    if (state.filters.directions.size < ALL_DIRECTIONS.length) {
        p.set(
            'dir',
            [...state.filters.directions]
                .map((d) => DIR_CODE[d])
                .filter(Boolean)
                .join(','),
        );
    }
    if (state.filters.kinds.size < ALL_KINDS.length) {
        p.set(
            'kind',
            [...state.filters.kinds]
                .map((k) => KIND_CODE[k])
                .filter(Boolean)
                .join(','),
        );
    }
    if (!state.filters.showStreams) p.set('streams', '0');
    if (state.filters.search) p.set('q', state.filters.search);
    if (state.selectedSeq !== null) p.set('seq', String(state.selectedSeq));
    if (state.detailTab !== 'tree') p.set('tab', state.detailTab);
    if (state.playhead !== null) p.set('play', String(state.playhead));

    const query = p.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(window.history.state, '', next);
    }
}
