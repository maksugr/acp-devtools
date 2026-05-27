import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDiscoveryStore } from './discoveryStore';
import type { ActiveCapture } from '@acp-devtools/core';
import type { SavedSession } from '../api/sessions';

const STORAGE_KEY = 'acp.discovery.selectedUrl';

const capture = (overrides: Partial<ActiveCapture> = {}): ActiveCapture => ({
    version: 1,
    pid: 1234,
    host: '127.0.0.1',
    port: 53000,
    url: 'ws://127.0.0.1:53000',
    agentCommand: 'mock',
    sessionName: null,
    sessionDbId: null,
    saveTo: null,
    startedAt: 1000,
    clientName: null,
    ...overrides,
});

const savedSession = (overrides: Partial<SavedSession> = {}): SavedSession => ({
    id: 1,
    name: null,
    agent_command: 'mock',
    started_at: 1000,
    ended_at: null,
    message_count: 5,
    client_name: null,
    imported_at: null,
    client_version: null,
    client_platform: null,
    agent_name: null,
    agent_version: null,
    protocol_version: null,
    current_mode: null,
    current_model: null,
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [],
        selectedUrl: null,
        lastFetchAt: null,
        lastError: null,
    });
});

afterEach(() => {
    localStorage.clear();
});

describe('discoveryStore', () => {
    it('starts with empty captures and saved sessions', () => {
        const s = useDiscoveryStore.getState();
        expect(s.captures).toEqual([]);
        expect(s.savedSessions).toEqual([]);
        expect(s.lastFetchAt).toBeNull();
        expect(s.lastError).toBeNull();
    });

    it('setCaptures stores the list and stamps lastFetchAt', () => {
        const before = Date.now();
        useDiscoveryStore.getState().setCaptures([capture({ pid: 1 }), capture({ pid: 2 })]);
        const s = useDiscoveryStore.getState();
        expect(s.captures).toHaveLength(2);
        expect(s.lastFetchAt).not.toBeNull();
        expect(s.lastFetchAt!).toBeGreaterThanOrEqual(before);
        expect(s.lastError).toBeNull();
    });

    it('setCaptures clears a prior error', () => {
        useDiscoveryStore.getState().setError('boom');
        expect(useDiscoveryStore.getState().lastError).toBe('boom');
        useDiscoveryStore.getState().setCaptures([]);
        expect(useDiscoveryStore.getState().lastError).toBeNull();
    });

    it('setSavedSessions does not touch captures or lastFetchAt', () => {
        useDiscoveryStore.getState().setCaptures([capture()]);
        const fetchedAt = useDiscoveryStore.getState().lastFetchAt;
        useDiscoveryStore.getState().setSavedSessions([savedSession()]);
        const s = useDiscoveryStore.getState();
        expect(s.savedSessions).toHaveLength(1);
        expect(s.captures).toHaveLength(1);
        expect(s.lastFetchAt).toBe(fetchedAt);
    });

    it('setSelected persists the url to localStorage', () => {
        useDiscoveryStore.getState().setSelected('ws://127.0.0.1:1111');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('ws://127.0.0.1:1111');
        expect(useDiscoveryStore.getState().selectedUrl).toBe('ws://127.0.0.1:1111');
    });

    it('setSelected(null) removes the persisted entry', () => {
        useDiscoveryStore.getState().setSelected('ws://127.0.0.1:1111');
        useDiscoveryStore.getState().setSelected(null);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(useDiscoveryStore.getState().selectedUrl).toBeNull();
    });

    it('setError stores the message', () => {
        useDiscoveryStore.getState().setError('discovery: HTTP 500');
        expect(useDiscoveryStore.getState().lastError).toBe('discovery: HTTP 500');
    });
});
