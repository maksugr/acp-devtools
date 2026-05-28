import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
