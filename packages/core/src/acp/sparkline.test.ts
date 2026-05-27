import { describe, expect, it } from 'vitest';
import { asciiSparkline, sampleEvenly } from './sparkline.js';

describe('sampleEvenly', () => {
    it('returns input as-is when shorter than target', () => {
        expect(sampleEvenly([1, 2, 3], 8)).toEqual([1, 2, 3]);
    });

    it('picks evenly-spaced elements when input is larger', () => {
        const out = sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
        expect(out).toHaveLength(5);
        expect(out[0]).toBe(1);
        expect(out[out.length - 1]).toBe(10);
    });
});

describe('asciiSparkline', () => {
    it('returns empty string for empty input', () => {
        expect(asciiSparkline([])).toBe('');
    });

    it('returns empty string when all values are zero', () => {
        expect(asciiSparkline([0, 0, 0])).toBe('');
    });

    it('renders ascending bars for monotonic input', () => {
        // Sorted ascending → bars climb left-to-right.
        const out = asciiSparkline([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(out).toHaveLength(8);
        // Last bar is the tallest possible block.
        expect(out[out.length - 1]).toBe('█');
        // First bar is one of the shorter blocks (low end of the ramp).
        expect('▁▂▃'.includes(out[0]!)).toBe(true);
    });

    it('compresses long input down to targetWidth', () => {
        const out = asciiSparkline(Array.from({ length: 100 }, (_, i) => i + 1), 6);
        expect(out).toHaveLength(6);
    });

    it('shows a tall-bar-only tail for a long-tail distribution', () => {
        const out = asciiSparkline([1, 1, 1, 1, 1, 1, 1, 100]);
        // Lots of low ▁ on the left, one █ on the right.
        expect(out[out.length - 1]).toBe('█');
        expect(out.slice(0, -1)).toMatch(/^▁+$/);
    });
});
