import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    activeDir,
    discoveryBaseDir,
    listActive,
    removeActiveFile,
    writeActiveFile,
} from './registry.js';
import type { ActiveCapture } from './types.js';

const fixture = (overrides: Partial<ActiveCapture> = {}): ActiveCapture => ({
    version: 1,
    pid: process.pid,
    host: '127.0.0.1',
    port: 12345,
    url: 'ws://127.0.0.1:12345',
    agentCommand: 'mock',
    sessionName: null,
    sessionDbId: null,
    saveTo: null,
    startedAt: Date.now(),
    ...overrides,
});

describe('discovery registry', () => {
    let prev: string | undefined;
    let tmp: string;

    beforeEach(() => {
        prev = process.env.ACP_DEVTOOLS_HOME;
        tmp = mkdtempSync(join(tmpdir(), 'acp-disc-'));
        process.env.ACP_DEVTOOLS_HOME = tmp;
    });

    afterEach(() => {
        if (prev === undefined) delete process.env.ACP_DEVTOOLS_HOME;
        else process.env.ACP_DEVTOOLS_HOME = prev;
        rmSync(tmp, { recursive: true, force: true });
    });

    it('resolves base dir from env override', () => {
        expect(discoveryBaseDir()).toBe(tmp);
        expect(activeDir()).toBe(join(tmp, 'active'));
    });

    it('writes and lists an active capture for live pid', () => {
        const record = fixture();
        const path = writeActiveFile(record);
        expect(path.endsWith(`${process.pid}.json`)).toBe(true);
        const list = listActive();
        expect(list).toHaveLength(1);
        expect(list[0]?.pid).toBe(process.pid);
        expect(list[0]?.url).toBe('ws://127.0.0.1:12345');
    });

    it('prunes stale descriptors with dead pids', () => {
        // PID 1 is init, alive on every Unix. Use something virtually-impossible.
        const ghostPid = 0x7ffffffe;
        writeActiveFile(fixture({ pid: ghostPid }));
        const list = listActive();
        expect(list.some((r) => r.pid === ghostPid)).toBe(false);
    });

    it('prunes malformed json', () => {
        mkdirSync(activeDir(), { recursive: true });
        writeFileSync(join(activeDir(), '999.json'), 'not json');
        const before = readdirSync(activeDir());
        expect(before).toContain('999.json');
        listActive(); // prunes side-effect
        const after = readdirSync(activeDir());
        expect(after).not.toContain('999.json');
    });

    it('removes the descriptor for a pid', () => {
        writeActiveFile(fixture());
        expect(listActive()).toHaveLength(1);
        removeActiveFile(process.pid);
        expect(listActive()).toHaveLength(0);
    });
});
