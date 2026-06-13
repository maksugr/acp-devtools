import { cn } from '../lib/cn';

export type RailState = 'played' | 'current' | 'upcoming';

/**
 * Left-gutter playback rail. A continuous vertical line per row: solid where
 * the playhead has passed, a knob on the current row, dotted ahead. Pure ink
 * tones — the rail marks position without recolouring the frames themselves.
 */
const SOLID = 'border-ink-secondary/45';
const DASHED = 'border-dashed border-ink-muted/35';

export function PlayheadRail({
    state,
    firstRow = false,
    lastRow = false,
}: {
    state: RailState;
    firstRow?: boolean;
    lastRow?: boolean;
}) {
    // The rail spans only the playable range: the centre of the first event to
    // the centre of the last — that's the full travel of the knob. Above the
    // first centre and below the last there is nothing to point at, so those
    // half-segments are dropped. Each half is solid where the playhead has
    // already passed, dashed where it hasn't.
    const topSolid = state !== 'upcoming';
    const bottomSolid = state === 'played';
    return (
        <span aria-hidden className="relative w-4 shrink-0 self-stretch">
            {!firstRow && (
                <span
                    className={cn(
                        'absolute left-1/2 top-0 h-1/2 -translate-x-1/2 border-l',
                        topSolid ? SOLID : DASHED,
                    )}
                />
            )}
            {!lastRow && (
                <span
                    className={cn(
                        'absolute bottom-0 left-1/2 h-1/2 -translate-x-1/2 border-l',
                        bottomSolid ? SOLID : DASHED,
                    )}
                />
            )}
            {state === 'current' && (
                <span className="absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-primary ring-2 ring-surface-base" />
            )}
        </span>
    );
}

export function railStateFor(
    entryMinSeq: number,
    entryMaxSeq: number,
    playhead: number | null,
): RailState {
    if (playhead === null) return 'upcoming';
    if (playhead >= entryMinSeq && playhead <= entryMaxSeq) return 'current';
    if (entryMaxSeq < playhead) return 'played';
    return 'upcoming';
}
