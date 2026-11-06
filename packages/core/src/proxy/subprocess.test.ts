// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnAgent } from './subprocess.js';

// A stand-in for the agent process, so each test decides the order in which
// `exit`, stdout data and `close` arrive. The real ordering depends on the OS
// (Windows routinely delivers `exit` before the last stdout bytes are read),
// so driving it by hand is the only way to test it the same everywhere.
class FakeChild extends EventEmitter {
    pid = 4242;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill = vi.fn(() => true);
}

const fake: { child: FakeChild | null } = { child: null };

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        spawn: (...args: Parameters<typeof actual.spawn>) => fake.child ?? actual.spawn(...args),
    };
});

afterEach(() => {
    fake.child = null;
});

function spawnFake(stdioGraceMs?: number) {
    const child = new FakeChild();
    fake.child = child;
    const agent = spawnAgent({
        command: 'agent',
        ...(stdioGraceMs !== undefined ? { stdioGraceMs } : {}),
    });
    let out = '';
    agent.stdout.on('data', (d: Buffer) => (out += d.toString()));
    let settled = false;
    void agent.exited.then(
        () => (settled = true),
        () => (settled = true),
    );
    return { child, agent, output: () => out, settled: () => settled };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('spawnAgent — exit handling', () => {
    it('waits for stdio to close after `exit`, so late stdout still arrives', async () => {
        const { child, agent, output, settled } = spawnFake();

        child.emit('exit', 0, null);
        await tick();
        expect(settled()).toBe(false);

        child.stdout.write('late frame\n');
        child.emit('close', 0, null);

        expect(await agent.exited).toEqual({ code: 0, signal: null });
        expect(output()).toContain('late frame');
    });

    it('reports the code and signal from `exit`', async () => {
        const { child, agent } = spawnFake();

        child.emit('exit', null, 'SIGTERM');
        child.emit('close', null, null);

        expect(await agent.exited).toEqual({ code: null, signal: 'SIGTERM' });
    });

    it('gives up on stdio after the grace period, so a stray child holding stdout cannot hang it', async () => {
        const { child, agent, settled } = spawnFake(20);

        child.emit('exit', 0, null);
        await tick();
        expect(settled()).toBe(false);

        expect(await agent.exited).toEqual({ code: 0, signal: null });
    });

    it('rejects when the agent cannot be spawned', async () => {
        const { child, agent } = spawnFake();

        child.emit('error', new Error('spawn agent ENOENT'));

        await expect(agent.exited).rejects.toThrow('ENOENT');
    });

    it('works end to end with a real process', async () => {
        const agent = spawnAgent({
            command: process.execPath,
            args: ['-e', 'process.stdout.write("bye\\n"); process.exit(3)'],
        });
        let out = '';
        agent.stdout.on('data', (d: Buffer) => (out += d.toString()));

        expect(await agent.exited).toEqual({ code: 3, signal: null });
        expect(out).toBe('bye\n');
    });
});
