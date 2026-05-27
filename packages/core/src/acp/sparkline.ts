/**
 * Tiny distribution-sampling utility shared by UI (SVG bars) and CLI (ASCII
 * blocks). Lives in core so both layers compute identical buckets.
 */

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Pick at most `targetCount` items from a sorted array, evenly spaced. For
 * smaller arrays returns the input as-is.
 */
export function sampleEvenly<T>(values: T[], targetCount: number): T[] {
    if (values.length <= targetCount) return values;
    const out: T[] = [];
    for (let i = 0; i < targetCount; i++) {
        const idx = Math.round((i * (values.length - 1)) / (targetCount - 1));
        out.push(values[idx]!);
    }
    return out;
}

/**
 * ASCII sparkline using Unicode block-elements (`▁▂▃▄▅▆▇█`). Input must be
 * sorted ascending. Empty / all-zero inputs return an empty string.
 */
export function asciiSparkline(values: number[], targetWidth = 8): string {
    if (values.length === 0) return '';
    const max = values[values.length - 1] ?? 0;
    if (max === 0) return '';
    const sampled = sampleEvenly(values, targetWidth);
    return sampled
        .map((v) => {
            const idx = Math.min(BLOCKS.length - 1, Math.floor((v / max) * BLOCKS.length));
            return BLOCKS[idx]!;
        })
        .join('');
}
