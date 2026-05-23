import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUrlState, writeUrlState } from './urlState';
import { ALL_DIRECTIONS, ALL_KINDS } from '../store/messagesStore';
import type { Filters } from '../store/messagesStore';

const defaultFilters = (): Filters => ({
    directions: new Set(ALL_DIRECTIONS),
    kinds: new Set(ALL_KINDS),
    search: '',
    hideBoilerplate: false,
    showStreams: true,
});

describe('parseUrlState', () => {
    it('returns empty filters and null defaults for blank query', () => {
        const s = parseUrlState('');
        expect(s.filters).toEqual({});
        expect(s.selectedSeq).toBeNull();
        expect(s.detailTab).toBeNull();
        expect(s.playbackCap).toBeNull();
        expect(s.captureUrl).toBeNull();
    });

    it('decodes direction codes', () => {
        const s = parseUrlState('?dir=out');
        expect(s.filters.directions).toEqual(new Set(['editor-to-agent']));
    });

    it('decodes kind codes', () => {
        const s = parseUrlState('?kind=req,ntf');
        expect(s.filters.kinds).toEqual(new Set(['request', 'notification']));
    });

    it('reads boolean filters', () => {
        const s = parseUrlState('?hide-bp=1&streams=0');
        expect(s.filters.hideBoilerplate).toBe(true);
        expect(s.filters.showStreams).toBe(false);
    });

    it('reads search query', () => {
        expect(parseUrlState('?q=session%2Fprompt').filters.search).toBe('session/prompt');
    });

    it('reads selected seq only when numeric', () => {
        expect(parseUrlState('?seq=42').selectedSeq).toBe(42);
        expect(parseUrlState('?seq=abc').selectedSeq).toBeNull();
    });

    it('reads detail tab only for known values', () => {
        expect(parseUrlState('?tab=meta').detailTab).toBe('meta');
        expect(parseUrlState('?tab=raw').detailTab).toBe('raw');
        expect(parseUrlState('?tab=bogus').detailTab).toBeNull();
    });

    it('reads playback cap only when numeric', () => {
        expect(parseUrlState('?play=15').playbackCap).toBe(15);
        expect(parseUrlState('?play=oops').playbackCap).toBeNull();
    });

    it('reads capture URL verbatim', () => {
        expect(parseUrlState('?ws=ws%3A%2F%2F127.0.0.1%3A53000').captureUrl).toBe(
            'ws://127.0.0.1:53000',
        );
    });

    it('ignores unknown directions and kinds gracefully', () => {
        const s = parseUrlState('?dir=garbage&kind=junk');
        expect(s.filters.directions).toBeUndefined();
        expect(s.filters.kinds).toBeUndefined();
    });
});

describe('writeUrlState', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/');
    });
    afterEach(() => {
        window.history.replaceState(null, '', '/');
    });

    it('keeps the URL empty when state equals defaults', () => {
        writeUrlState({
            filters: defaultFilters(),
            selectedSeq: null,
            detailTab: 'tree',
            playbackCap: null,
            captureUrl: null,
        });
        expect(window.location.search).toBe('');
    });

    it('encodes the whole state and survives a round-trip', () => {
        writeUrlState({
            filters: {
                directions: new Set(['editor-to-agent']),
                kinds: new Set(['request', 'response']),
                search: 'foo bar',
                hideBoilerplate: true,
                showStreams: false,
            },
            selectedSeq: 42,
            detailTab: 'meta',
            playbackCap: 7,
            captureUrl: 'ws://127.0.0.1:53000',
        });
        const parsed = parseUrlState(window.location.search);
        expect(parsed.captureUrl).toBe('ws://127.0.0.1:53000');
        expect(parsed.selectedSeq).toBe(42);
        expect(parsed.detailTab).toBe('meta');
        expect(parsed.playbackCap).toBe(7);
        expect(parsed.filters.directions).toEqual(new Set(['editor-to-agent']));
        expect(parsed.filters.kinds).toEqual(new Set(['request', 'response']));
        expect(parsed.filters.search).toBe('foo bar');
        expect(parsed.filters.hideBoilerplate).toBe(true);
        expect(parsed.filters.showStreams).toBe(false);
    });

    it('preserves non-owned query parameters', () => {
        window.history.replaceState(null, '', '/?keep=me&dir=in');
        writeUrlState({
            filters: defaultFilters(),
            selectedSeq: null,
            detailTab: 'tree',
            playbackCap: null,
            captureUrl: null,
        });
        const params = new URLSearchParams(window.location.search);
        expect(params.get('keep')).toBe('me');
        expect(params.get('dir')).toBeNull();
    });

    it('uses history.replaceState (does not add to history stack)', () => {
        const beforeLen = window.history.length;
        writeUrlState({
            filters: defaultFilters(),
            selectedSeq: 1,
            detailTab: 'tree',
            playbackCap: null,
            captureUrl: null,
        });
        expect(window.history.length).toBe(beforeLen);
    });
});
