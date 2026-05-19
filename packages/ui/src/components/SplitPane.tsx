import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

interface SplitPaneProps {
    left: React.ReactNode;
    right: React.ReactNode;
    storageKey?: string;
    initialLeftFraction?: number;
    minLeft?: number;
    minRight?: number;
}

export function SplitPane({
    left,
    right,
    storageKey,
    initialLeftFraction = 0.6,
    minLeft = 320,
    minRight = 320,
}: SplitPaneProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [leftPx, setLeftPx] = useState<number | null>(null);
    const dragging = useRef(false);

    useEffect(() => {
        if (!containerRef.current) return;
        const total = containerRef.current.clientWidth;
        const stored = storageKey ? Number(localStorage.getItem(storageKey)) : NaN;
        if (storageKey && Number.isFinite(stored) && stored > 0 && stored < total) {
            setLeftPx(stored);
        } else {
            setLeftPx(Math.round(total * initialLeftFraction));
        }
    }, [initialLeftFraction, storageKey]);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!dragging.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const total = rect.width;
            const next = Math.min(Math.max(x, minLeft), total - minRight);
            setLeftPx(next);
            if (storageKey) localStorage.setItem(storageKey, String(Math.round(next)));
        },
        [minLeft, minRight, storageKey],
    );

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        dragging.current = false;
        try {
            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch {
            // ignore
        }
    }, []);

    return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden">
            <div style={{ width: leftPx ?? '60%' }} className="flex h-full min-w-0 flex-col">
                {left}
            </div>
            <div
                role="separator"
                aria-orientation="vertical"
                className={cn(
                    'group relative w-px shrink-0 cursor-col-resize bg-line',
                    'before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div className="absolute inset-y-0 left-0 w-px bg-line transition-colors group-hover:bg-accent-out/40" />
            </div>
            <div className="flex h-full min-w-0 flex-1 flex-col">{right}</div>
        </div>
    );
}
