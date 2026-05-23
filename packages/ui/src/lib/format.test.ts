import { describe, expect, it } from 'vitest';
import {
    directionArrow,
    directionLabel,
    formatAge,
    formatBytes,
    formatDateTime,
    formatLatency,
    formatRelative,
    formatTime,
    formatTimeMs,
    latencyTone,
    percentile,
} from './format';

describe('formatBytes', () => {
    it('shows raw bytes under 1 KB', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1023)).toBe('1023 B');
    });
    it('shows KB with one decimal', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(15_872)).toBe('15.5 KB');
    });
    it('shows MB with one decimal', () => {
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB');
    });
});

describe('formatLatency', () => {
    it('clamps sub-millisecond', () => {
        expect(formatLatency(0)).toBe('<1ms');
        expect(formatLatency(0.4)).toBe('<1ms');
    });
    it('renders ms under 1s', () => {
        expect(formatLatency(15)).toBe('15ms');
        expect(formatLatency(999)).toBe('999ms');
    });
    it('renders seconds with two decimals beyond 1s', () => {
        expect(formatLatency(1234)).toBe('1.23s');
        expect(formatLatency(30_500)).toBe('30.50s');
    });
});

describe('latencyTone', () => {
    it('green under 250ms', () => {
        expect(latencyTone(0)).toBe('ok');
        expect(latencyTone(249)).toBe('ok');
    });
    it('amber up to 1500ms', () => {
        expect(latencyTone(250)).toBe('warn');
        expect(latencyTone(1499)).toBe('warn');
    });
    it('red beyond 1500ms', () => {
        expect(latencyTone(1500)).toBe('error');
        expect(latencyTone(60_000)).toBe('error');
    });
});

describe('directionArrow & directionLabel', () => {
    it('describes editor → agent', () => {
        expect(directionArrow('editor-to-agent')).toBe('→');
        expect(directionLabel('editor-to-agent')).toBe('OUT');
    });
    it('describes agent → editor', () => {
        expect(directionArrow('agent-to-editor')).toBe('←');
        expect(directionLabel('agent-to-editor')).toBe('IN');
    });
});

describe('formatRelative', () => {
    it('renders positive seconds', () => {
        expect(formatRelative(15_000, 0)).toBe('+15s');
    });
    it('renders minutes and seconds for > 60s', () => {
        expect(formatRelative(75_000, 0)).toBe('+1m15s');
        expect(formatRelative(125_000, 0)).toBe('+2m05s');
    });
});

describe('formatTime / formatTimeMs', () => {
    it('renders HH:MM:SS in UTC fixture', () => {
        // Time-zone agnostic check via format pattern only.
        expect(formatTime(0)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(formatTimeMs(0)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });
    it('appends milliseconds correctly', () => {
        const base = 1_700_000_000_000;
        expect(formatTimeMs(base + 5)).toMatch(/\.005$/);
        expect(formatTimeMs(base + 999)).toMatch(/\.999$/);
    });
});

describe('formatAge', () => {
    const now = 1_700_000_000_000;
    it('seconds when under a minute', () => {
        expect(formatAge(now - 0, now)).toBe('0s');
        expect(formatAge(now - 59_000, now)).toBe('59s');
    });
    it('minutes under an hour', () => {
        expect(formatAge(now - 60_000, now)).toBe('1m');
        expect(formatAge(now - 47 * 60 * 1000, now)).toBe('47m');
    });
    it('hours + minutes under a day', () => {
        expect(formatAge(now - (2 * 60 + 5) * 60_000, now)).toBe('2h05m');
        expect(formatAge(now - 23 * 60 * 60_000, now)).toBe('23h00m');
    });
    it('days + hours beyond a day', () => {
        const threeDaysFiveHours = (3 * 24 + 5) * 60 * 60_000;
        expect(formatAge(now - threeDaysFiveHours, now)).toBe('3d05h');
    });
    it('never returns negative', () => {
        expect(formatAge(now + 100, now)).toBe('0s');
    });
});

describe('formatDateTime', () => {
    const today = new Date(2026, 4, 20, 14, 6, 57).getTime(); // May 20 2026, 14:06:57
    it('drops date when same day', () => {
        const sameDay = new Date(2026, 4, 20, 9, 0, 0).getTime();
        expect(formatDateTime(sameDay, today)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
    it('adds month + day within same year', () => {
        const sameYear = new Date(2026, 4, 18, 14, 6, 57).getTime();
        expect(formatDateTime(sameYear, today)).toMatch(/^May 18 \d{2}:\d{2}:\d{2}$/);
    });
    it('adds full year for other years', () => {
        const lastYear = new Date(2025, 11, 31, 14, 6, 57).getTime();
        expect(formatDateTime(lastYear, today)).toMatch(/^2025-12-31 \d{2}:\d{2}:\d{2}$/);
    });
});

describe('percentile', () => {
    it('returns 0 for empty', () => {
        expect(percentile([], 50)).toBe(0);
    });
    it('returns single value', () => {
        expect(percentile([42], 50)).toBe(42);
        expect(percentile([42], 99)).toBe(42);
    });
    it('computes p50 of a sorted set', () => {
        expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    });
    it('interpolates between samples', () => {
        const p = percentile([0, 100], 25);
        expect(p).toBeCloseTo(25);
    });
});
