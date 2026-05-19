import { create } from 'zustand';
import type { ActiveCapture } from '@acp-devtools/core';

interface DiscoveryState {
    captures: ActiveCapture[];
    selectedUrl: string | null;
    lastFetchAt: number | null;
    lastError: string | null;

    setCaptures: (captures: ActiveCapture[]) => void;
    setSelected: (url: string | null) => void;
    setError: (msg: string | null) => void;
}

const STORAGE_KEY = 'acp.discovery.selectedUrl';

function loadSelected(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function persistSelected(url: string | null): void {
    try {
        if (url) localStorage.setItem(STORAGE_KEY, url);
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore quota / privacy errors
    }
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
    captures: [],
    selectedUrl: loadSelected(),
    lastFetchAt: null,
    lastError: null,

    setCaptures: (captures) => set({ captures, lastFetchAt: Date.now(), lastError: null }),
    setSelected: (url) => {
        persistSelected(url);
        set({ selectedUrl: url });
    },
    setError: (msg) => set({ lastError: msg }),
}));
