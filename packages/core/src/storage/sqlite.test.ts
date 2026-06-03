import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, openExistingDatabase } from './sqlite.js';

let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-sqlite-'));
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

describe('openExistingDatabase', () => {
    it('throws "no such database" for a missing path without creating a file', () => {
        const missing = join(tmp, 'nope.db');
        expect(() => openExistingDatabase(missing)).toThrow(/no such database/);
        // The footgun this guards against: it must NOT leave an empty db behind.
        expect(existsSync(missing)).toBe(false);
    });

    it('opens an existing database', () => {
        const path = join(tmp, 'real.db');
        openDatabase(path).close(); // create it
        const db = openExistingDatabase(path);
        expect(db).toBeDefined();
        db.close();
    });

    it('allows :memory:', () => {
        const db = openExistingDatabase(':memory:');
        expect(db).toBeDefined();
        db.close();
    });
});

describe('openDatabase — file permissions', () => {
    // captures.db holds proxy_key / Authorization headers verbatim; group/other
    // readers on the system would be a leak vector. macOS / Linux POSIX modes
    // only — NTFS uses ACLs so this assertion is skipped on Windows.
    const skip = process.platform === 'win32';

    it.skipIf(skip)('creates a fresh DB with 0o600 (owner-only) mode', () => {
        const path = join(tmp, 'fresh.db');
        const db = openDatabase(path);
        try {
            const mode = statSync(path).mode & 0o777;
            expect(mode).toBe(0o600);
        } finally {
            db.close();
        }
    });

    it.skipIf(skip)('tightens an existing DB whose mode is too permissive', () => {
        const path = join(tmp, 'loose.db');
        openDatabase(path).close();
        chmodSync(path, 0o644); // simulate a db created before the fix shipped
        const db = openDatabase(path);
        try {
            const mode = statSync(path).mode & 0o777;
            expect(mode).toBe(0o600);
        } finally {
            db.close();
        }
    });

    it.skipIf(skip)('tightens the WAL sidecar file too', () => {
        const path = join(tmp, 'wal-side.db');
        const db = openDatabase(path);
        try {
            // Force WAL sidecar creation by writing a row.
            db.exec(`INSERT INTO sessions (name, started_at) VALUES ('t', 1)`);
            const walPath = `${path}-wal`;
            if (existsSync(walPath)) {
                const mode = statSync(walPath).mode & 0o777;
                expect(mode).toBe(0o600);
            }
        } finally {
            db.close();
        }
    });
});
