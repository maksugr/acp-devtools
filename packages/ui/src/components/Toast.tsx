import { cn } from '../lib/cn';

interface ToastProps {
    message: string | null;
    tone?: 'info' | 'success' | 'warn';
}

export function Toast({ message, tone = 'info' }: ToastProps) {
    if (!message) return null;
    const palette =
        tone === 'success'
            ? 'border-accent-out/50 bg-accent-out/10 text-accent-out'
            : tone === 'warn'
              ? 'border-accent-warn/50 bg-accent-warn/10 text-accent-warn'
              : 'border-accent-info/50 bg-accent-info/10 text-accent-info';
    return (
        <div
            role="status"
            className={cn(
                'pointer-events-none fixed right-4 top-[60px] z-50 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-widest shadow-lg backdrop-blur-sm',
                palette,
            )}
        >
            {message}
        </div>
    );
}
