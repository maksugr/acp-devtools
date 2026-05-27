import { sampleEvenly } from '@acp-devtools/core/acp/sparkline';
import { cn } from '../lib/cn';

interface SparklineProps {
    /** Sorted-ascending latency samples. */
    values: number[];
    width?: number;
    height?: number;
    className?: string;
    title?: string;
}

/**
 * Tiny inline-SVG distribution viz. Sorted bars (low → high) — at a glance
 * shows whether a method is uniformly fast, uniformly slow, or has a long
 * tail (a few tall bars on the right against many short ones on the left).
 *
 * Returns null on empty input so callers can branch on
 * `values.length === 0` before placing this in a layout with fixed width.
 */
export function Sparkline({
    values,
    width = 64,
    height = 14,
    className,
    title,
}: SparklineProps) {
    if (values.length === 0) return null;
    const max = values[values.length - 1] ?? 0;
    if (max === 0) return null;

    // Cap bar count so each bar stays ≥3px on the configured width.
    const maxBars = Math.max(1, Math.floor(width / 4));
    const sampled = sampleEvenly(values, maxBars);

    const gap = 1;
    const barWidth = (width - gap * (sampled.length - 1)) / sampled.length;

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className={cn('inline-block align-middle', className)}
            role="img"
            aria-label={title ?? `latency distribution, ${values.length} samples`}
        >
            {sampled.map((v, i) => {
                const h = Math.max(1, (v / max) * height);
                return (
                    <rect
                        key={i}
                        x={i * (barWidth + gap)}
                        y={height - h}
                        width={barWidth}
                        height={h}
                        fill="currentColor"
                        opacity={0.4 + (v / max) * 0.6}
                    />
                );
            })}
        </svg>
    );
}
