import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface SpecHintProps {
    /** Content shown inside the popover. */
    label: ReactNode;
    /** Inline trigger — `ⓘ` icon, badge, etc. */
    children: ReactNode;
    /**
     * Show delay in ms. Short enough to feel instant but long enough to
     * suppress flicker when the cursor glides across nearby triggers.
     * Default 60ms.
     */
    delay?: number;
    /** Tone — controls border + accent colour. */
    tone?: 'info' | 'warn' | 'error';
    /** Optional className applied to the trigger wrapper. */
    className?: string;
    /**
     * Add the wrapper to the Tab order and show the popover on focus.
     * Default `false` — most labels don't deserve to be a tab stop, and
     * blanket-focusable hints across the app create dozens of extra Tab
     * stops in TopBar / StatsBar / Timeline. Set `true` for primary
     * icon-triggers (ⓘ, ⚠) where the popover IS the affordance.
     */
    focusable?: boolean;
}

interface PopoverPos {
    top: number;
    left: number;
    /** When true, the popover is rendered above the trigger (origin = bottom). */
    flipUp: boolean;
}

const TONE_CLASSES: Record<NonNullable<SpecHintProps['tone']>, string> = {
    info: 'border-line bg-surface-base text-ink-primary',
    warn: 'border-accent-warn/40 bg-accent-warn/10 text-ink-primary',
    error: 'border-accent-error/40 bg-accent-error/10 text-ink-primary',
};

/**
 * Inline trigger + portal-rendered popover. Used in JsonTree for ACP-schema
 * descriptions and extension warnings. Native `title=` tooltips browse with a
 * ~1.5s delay — too slow when the hint IS the feature.
 */
export function SpecHint({
    label,
    children,
    delay = 60,
    tone = 'info',
    className,
    focusable = false,
}: SpecHintProps) {
    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [pos, setPos] = useState<PopoverPos | null>(null);

    const open = pos !== null;

    const compute = () => {
        const el = triggerRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const flipUp = spaceBelow < 120;
        return {
            top: flipUp ? rect.top - 8 : rect.bottom + 8,
            left: Math.min(rect.left, window.innerWidth - 380),
            flipUp,
        };
    };

    const show = () => {
        if (showTimer.current !== null) clearTimeout(showTimer.current);
        showTimer.current = setTimeout(() => {
            const p = compute();
            if (p) setPos(p);
        }, delay);
    };

    const hide = () => {
        if (showTimer.current !== null) {
            clearTimeout(showTimer.current);
            showTimer.current = null;
        }
        setPos(null);
    };

    useEffect(() => {
        return () => {
            if (showTimer.current !== null) clearTimeout(showTimer.current);
        };
    }, []);

    // Close on scroll — scrolling the DetailPanel under us would otherwise
    // leave the popover floating over the wrong row.
    useEffect(() => {
        if (!open) return;
        const onScroll = () => hide();
        window.addEventListener('scroll', onScroll, true);
        return () => window.removeEventListener('scroll', onScroll, true);
    }, [open]);

    return (
        <>
            <span
                ref={triggerRef}
                className={cn('cursor-help', className)}
                onMouseEnter={show}
                onMouseLeave={hide}
                {...(focusable
                    ? { onFocus: show, onBlur: hide, tabIndex: 0 }
                    : {})}
            >
                {children}
            </span>
            {pos &&
                createPortal(
                    <div
                        role="tooltip"
                        className={cn(
                            'pointer-events-none fixed z-[200] max-w-[360px] rounded-sm border px-3 py-2 font-mono text-[11px] leading-snug shadow-lg backdrop-blur-sm',
                            TONE_CLASSES[tone],
                        )}
                        style={{
                            top: pos.flipUp ? undefined : pos.top,
                            bottom: pos.flipUp ? window.innerHeight - pos.top : undefined,
                            left: pos.left,
                        }}
                    >
                        {label}
                    </div>,
                    document.body,
                )}
        </>
    );
}
