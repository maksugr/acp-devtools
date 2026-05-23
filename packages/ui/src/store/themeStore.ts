import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

interface ThemeState {
    mode: ThemeMode;
    resolved: Resolved;
    setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'acp.theme.v1';

function readStoredMode(): ThemeMode {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
        // ignore
    }
    return 'system';
}

function systemPrefersDark(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(mode: ThemeMode): Resolved {
    if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
    return mode;
}

function applyResolved(resolved: Resolved): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('light', resolved === 'light');
    root.classList.toggle('dark', resolved === 'dark');
}

const initialMode = typeof window !== 'undefined' ? readStoredMode() : 'system';
const initialResolved = resolve(initialMode);
if (typeof window !== 'undefined') applyResolved(initialResolved);

export const useThemeStore = create<ThemeState>((set) => ({
    mode: initialMode,
    resolved: initialResolved,
    setMode: (mode) => {
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // ignore quota / privacy errors
        }
        const resolved = resolve(mode);
        applyResolved(resolved);
        set({ mode, resolved });
    },
}));

/**
 * Listen to OS-level theme changes; only effective while `mode === 'system'`.
 * Returns a cleanup function for React useEffect.
 */
export function bindSystemThemeListener(): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
        const { mode, setMode } = useThemeStore.getState();
        if (mode !== 'system') return;
        // Re-applying triggers resolve + applyResolved.
        setMode('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
}
