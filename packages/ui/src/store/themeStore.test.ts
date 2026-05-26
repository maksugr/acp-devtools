import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSystemThemeListener, useThemeStore } from './themeStore';

const STORAGE_KEY = 'acp.theme.v1';

interface FakeMq {
    matches: boolean;
    listeners: Array<(ev: { matches: boolean }) => void>;
    addEventListener(_type: 'change', listener: (ev: { matches: boolean }) => void): void;
    removeEventListener(_type: 'change', listener: (ev: { matches: boolean }) => void): void;
    fire(matches: boolean): void;
}

function makeMq(initial: boolean): FakeMq {
    return {
        matches: initial,
        listeners: [],
        addEventListener(_type, listener) {
            this.listeners.push(listener);
        },
        removeEventListener(_type, listener) {
            this.listeners = this.listeners.filter((l) => l !== listener);
        },
        fire(matches: boolean) {
            this.matches = matches;
            for (const l of this.listeners) l({ matches });
        },
    };
}

let mq: FakeMq;

beforeEach(() => {
    localStorage.clear();
    mq = makeMq(true); // default: prefers dark
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation(() => mq),
    );
    // jsdom puts window.matchMedia separately
    window.matchMedia = vi.fn().mockImplementation(() => mq) as unknown as typeof window.matchMedia;
    document.documentElement.className = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.className = '';
});

describe('themeStore', () => {
    it('setMode("light") writes light class on <html> and persists', () => {
        useThemeStore.getState().setMode('light');
        const s = useThemeStore.getState();
        expect(s.mode).toBe('light');
        expect(s.resolved).toBe('light');
        expect(document.documentElement.classList.contains('light')).toBe(true);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('setMode("dark") writes dark class on <html> and persists', () => {
        useThemeStore.getState().setMode('dark');
        const s = useThemeStore.getState();
        expect(s.mode).toBe('dark');
        expect(s.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.classList.contains('light')).toBe(false);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('setMode("system") resolves via matchMedia', () => {
        mq.matches = true; // prefers dark
        useThemeStore.getState().setMode('system');
        expect(useThemeStore.getState().resolved).toBe('dark');

        mq.matches = false; // prefers light
        useThemeStore.getState().setMode('system');
        expect(useThemeStore.getState().resolved).toBe('light');
    });
});

describe('bindSystemThemeListener', () => {
    it('re-resolves only when mode is "system"', () => {
        useThemeStore.getState().setMode('system');
        const cleanup = bindSystemThemeListener();
        expect(mq.listeners).toHaveLength(1);

        // Initial state: dark
        expect(useThemeStore.getState().resolved).toBe('dark');

        // OS switches to light
        mq.fire(false);
        expect(useThemeStore.getState().resolved).toBe('light');

        cleanup();
        expect(mq.listeners).toHaveLength(0);
    });

    it('ignores OS changes when mode is "light" or "dark"', () => {
        useThemeStore.getState().setMode('dark');
        const cleanup = bindSystemThemeListener();
        mq.fire(false); // OS prefers light now
        expect(useThemeStore.getState().mode).toBe('dark');
        expect(useThemeStore.getState().resolved).toBe('dark');
        cleanup();
    });

    it('returns a no-op when matchMedia is unavailable', () => {
        window.matchMedia = undefined as unknown as typeof window.matchMedia;
        const cleanup = bindSystemThemeListener();
        expect(typeof cleanup).toBe('function');
        cleanup(); // should not throw
    });
});
