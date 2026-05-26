import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshActive, startDiscoveryPolling } from './discovery';
import { useDiscoveryStore } from '../store/discoveryStore';

function mockFetchOk(payload: unknown) {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payload),
    } as Response);
}

function mockFetchNotOk(status: number) {
    return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({}),
    } as Response);
}

beforeEach(() => {
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [],
        selectedUrl: null,
        lastFetchAt: null,
        lastError: null,
    });
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('refreshActive', () => {
    it('populates captures and savedSessions on a happy path', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                calls.push(url);
                if (url === '/api/active') return mockFetchOk({ captures: [{ pid: 1 }] });
                if (url === '/api/sessions') return mockFetchOk({ sessions: [{ id: 7 }] });
                return mockFetchNotOk(404);
            }),
        );
        await refreshActive();
        expect(calls.sort()).toEqual(['/api/active', '/api/sessions']);
        const s = useDiscoveryStore.getState();
        expect(s.captures).toHaveLength(1);
        expect(s.savedSessions).toHaveLength(1);
        expect(s.lastError).toBeNull();
    });

    it('treats failed /api/sessions as "keep previous list", not as a fatal error', async () => {
        // Seed previous saved sessions
        useDiscoveryStore.setState({ savedSessions: [{ id: 99 }] as never });
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url === '/api/active') return mockFetchOk({ captures: [] });
                if (url === '/api/sessions') return mockFetchNotOk(500);
                return mockFetchNotOk(404);
            }),
        );
        await refreshActive();
        const s = useDiscoveryStore.getState();
        expect(s.captures).toEqual([]);
        expect(s.savedSessions).toHaveLength(1); // preserved
        expect(s.lastError).toBeNull();
    });

    it('records lastError when /api/active fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url === '/api/active') return mockFetchNotOk(503);
                return mockFetchOk({ sessions: [] });
            }),
        );
        await refreshActive();
        const s = useDiscoveryStore.getState();
        expect(s.lastError).toMatch(/discovery: HTTP 503/);
    });

    it('handles missing captures field as empty list', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url === '/api/active') return mockFetchOk({});
                return mockFetchOk({ sessions: [] });
            }),
        );
        await refreshActive();
        expect(useDiscoveryStore.getState().captures).toEqual([]);
    });
});

describe('startDiscoveryPolling', () => {
    it('returns a cleanup that stops the interval', async () => {
        const fetchSpy = vi.fn(() => mockFetchOk({ captures: [], sessions: [] }));
        vi.stubGlobal('fetch', fetchSpy);
        const cleanup = startDiscoveryPolling();
        // Initial tick fires immediately (void tick()), no timer needed
        await vi.runOnlyPendingTimersAsync();
        const initialCalls = fetchSpy.mock.calls.length;
        cleanup();
        // After cleanup, advancing time should not produce new calls
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchSpy.mock.calls.length).toBe(initialCalls);
    });

    it('reuses a single interval — calling twice cleans up the old timer', async () => {
        const fetchSpy = vi.fn(() => mockFetchOk({ captures: [], sessions: [] }));
        vi.stubGlobal('fetch', fetchSpy);
        const cleanup1 = startDiscoveryPolling();
        const cleanup2 = startDiscoveryPolling();
        // Both registered, but module-level pollTimer should reference only the
        // most recent — calling cleanup2 stops further ticks.
        cleanup1();
        cleanup2();
        // Drain any pending micro/timer tasks before assertions
        await vi.runAllTimersAsync();
        const seen = fetchSpy.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchSpy.mock.calls.length).toBe(seen);
    });
});
