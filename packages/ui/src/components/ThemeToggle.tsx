import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useThemeStore, type ThemeMode } from '../store/themeStore';

const OPTIONS: Array<{ mode: ThemeMode; label: string; title: string; icon: string }> = [
    { mode: 'system', label: 'AUTO', title: 'follow OS theme', icon: '◐' },
    { mode: 'light', label: 'LIGHT', title: 'force light theme', icon: '☀' },
    { mode: 'dark', label: 'DARK', title: 'force dark theme', icon: '☾' },
];

export function ThemeToggle() {
    const mode = useThemeStore((s) => s.mode);
    const setMode = useThemeStore((s) => s.setMode);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    const active = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0]!;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title={`theme · ${active.title}`}
                aria-haspopup="menu"
                aria-expanded={open}
                className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-sm border font-mono text-[12px] transition-colors',
                    open
                        ? 'border-line-strong bg-surface-rowHover text-ink-primary'
                        : 'border-line bg-surface-row text-ink-secondary hover:border-line-strong hover:text-ink-primary',
                )}
            >
                <span aria-hidden>{active.icon}</span>
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-50 inline-flex items-center gap-px rounded-sm border border-line bg-surface-elev p-px font-mono text-[10px] uppercase tracking-widest shadow-lg"
                >
                    {OPTIONS.map((opt) => {
                        const isActive = opt.mode === mode;
                        return (
                            <button
                                key={opt.mode}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isActive}
                                onClick={() => {
                                    setMode(opt.mode);
                                    setOpen(false);
                                }}
                                title={opt.title}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-[2px] px-2 py-1 transition-colors',
                                    isActive
                                        ? 'bg-accent-out/15 text-accent-out'
                                        : 'text-ink-muted hover:bg-surface-rowHover hover:text-ink-secondary',
                                )}
                            >
                                <span aria-hidden>{opt.icon}</span>
                                <span>{opt.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
