import { describe, expect, it } from 'vitest';
import { createStyler } from './style.js';
import { colorDirection, colorKind, colorLatency, colorSessionKind } from './palette.js';

const s = createStyler(true);
const off = createStyler(false);

describe('colorKind', () => {
    it('maps each frame kind to its palette colour', () => {
        expect(colorKind(s, 'request', 'REQ')).toBe(s.green('REQ'));
        expect(colorKind(s, 'response', 'RSP')).toBe(s.cyan('RSP'));
        expect(colorKind(s, 'notification', 'NTF')).toBe(s.yellow('NTF'));
        expect(colorKind(s, 'error', 'ERR')).toBe(s.red('ERR'));
        expect(colorKind(s, 'unknown', 'UNK')).toBe(s.dim('UNK'));
    });

    it('is a no-op when colour is disabled', () => {
        expect(colorKind(off, 'error', 'ERR')).toBe('ERR');
    });
});

describe('colorDirection', () => {
    it('greens editor→agent and cyans agent→editor', () => {
        expect(colorDirection(s, 'editor-to-agent', '→A')).toBe(s.green('→A'));
        expect(colorDirection(s, 'agent-to-editor', 'A←')).toBe(s.cyan('A←'));
    });
});

describe('colorLatency', () => {
    it('escalates colour with magnitude', () => {
        expect(colorLatency(s, 50, '50ms')).toBe(s.green('50ms'));
        expect(colorLatency(s, 500, '500ms')).toBe('500ms');
        expect(colorLatency(s, 2000, '2.0s')).toBe(s.yellow('2.0s'));
        expect(colorLatency(s, 9000, '9.0s')).toBe(s.red('9.0s'));
    });
});

describe('colorSessionKind', () => {
    it('greens saved and ambers imported', () => {
        expect(colorSessionKind(s, false, 'saved')).toBe(s.green('saved'));
        expect(colorSessionKind(s, true, 'imported')).toBe(s.yellow('imported'));
    });
});
