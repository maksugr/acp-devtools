// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPairIndex } from './method-stats.js';
import {
    isRemovedFromSpecField,
    isRemovedFromSpecMethod,
    REMOVED_FROM_SPEC,
} from './removed-from-spec.js';
import { ACP_SCHEMAS } from './schemas.js';
import { knownAcpSpecMethods, resolveSpecForMessage } from './spec-decoder.js';
import type { CapturedMessage } from './types.js';

interface Node {
    $ref?: string;
    properties?: Record<string, Node>;
    items?: Node;
    allOf?: Node[];
    anyOf?: Node[];
    oneOf?: Node[];
}

/** Every property path reachable from a def, with union variants merged. */
function schemaPaths(defName: string): Set<string> {
    const defs = (ACP_SCHEMAS[1] as { $defs: Record<string, Node> }).$defs;
    const out = new Set<string>();
    const walk = (node: Node | undefined, prefix: string, seen: Set<string>): void => {
        if (!node) return;
        if (node.$ref) {
            const name = node.$ref.replace('#/$defs/', '');
            if (seen.has(name)) return;
            return walk(defs[name], prefix, new Set([...seen, name]));
        }
        for (const v of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
            walk(v, prefix, seen);
        }
        if (node.items) walk(node.items, `${prefix}[]`, seen);
        for (const [k, v] of Object.entries(node.properties ?? {})) {
            const p = prefix ? `${prefix}.${k}` : k;
            out.add(p);
            walk(v, p, seen);
        }
    };
    walk(defs[defName], '', new Set([defName]));
    return out;
}

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
    return 0;
}

describe('REMOVED_FROM_SPEC', () => {
    it('lists only fields the current v1 schema really lacks, on types it has', () => {
        const defs = (ACP_SCHEMAS[1] as { $defs: Record<string, unknown> }).$defs;
        for (const [type, fields] of Object.entries(REMOVED_FROM_SPEC.v1.fields)) {
            expect(defs[type], type).toBeDefined();
            const present = schemaPaths(type);
            for (const f of fields) expect(present.has(f), `${type}.${f}`).toBe(false);
        }
    });

    it('lists only methods the current v1 schema does not know', () => {
        const known = new Set(knownAcpSpecMethods(1));
        for (const m of REMOVED_FROM_SPEC.v1.methods) expect(known.has(m), m).toBe(false);
    });

    it(`is removed before ${REMOVED_FROM_SPEC.until} (https://github.com/maksugr/acp-devtools/issues/26)`, () => {
        const { version } = JSON.parse(
            readFileSync(join(process.cwd(), 'packages/core/package.json'), 'utf8'),
        ) as { version: string };
        // Reaching `until` means the transition is over: delete the list (or
        // move `until` and record why in the issue).
        expect(compareVersions(version, REMOVED_FROM_SPEC.until)).toBeLessThan(0);
    });
});

describe('isRemovedFromSpecField', () => {
    it('matches a removed field and everything under it', () => {
        expect(isRemovedFromSpecField('NewSessionResponse', ['models'])).toBe(true);
        expect(
            isRemovedFromSpecField('NewSessionResponse', ['models', 'availableModels', '0']),
        ).toBe(true);
    });

    it('matches through array items', () => {
        expect(isRemovedFromSpecField('InitializeResponse', ['authMethods', '1', 'vars'])).toBe(
            true,
        );
        expect(isRemovedFromSpecField('InitializeResponse', ['authMethods', '1', 'name'])).toBe(
            false,
        );
    });

    it('does not match a sibling with a shared prefix, another type or another version', () => {
        expect(isRemovedFromSpecField('NewSessionResponse', ['modelsExtra'])).toBe(false);
        expect(isRemovedFromSpecField('NewSessionRequest', ['models'])).toBe(false);
        expect(isRemovedFromSpecField('NewSessionResponse', ['models'], 2)).toBe(false);
    });
});

describe('isRemovedFromSpecMethod', () => {
    it('knows the dropped v1 methods only', () => {
        expect(isRemovedFromSpecMethod('session/set_model')).toBe(true);
        expect(isRemovedFromSpecMethod('session/set_model', 2)).toBe(false);
        expect(isRemovedFromSpecMethod('session/prompt')).toBe(false);
        expect(isRemovedFromSpecMethod(undefined)).toBe(false);
    });
});

describe('spec decoder on real captures', () => {
    function load(name: string): CapturedMessage[] {
        return (
            JSON.parse(readFileSync(join(process.cwd(), 'fixtures/handshakes', name), 'utf8')) as {
                messages: CapturedMessage[];
            }
        ).messages;
    }

    function resolveResponse(messages: CapturedMessage[], method: string, path: string[]) {
        const pairs = buildPairIndex(messages);
        const request = messages.find((m) => m.method === method && m.kind === 'request')!;
        const response = messages.find((m) => m.seq === pairs.get(request.seq)!.pairSeq)!;
        return resolveSpecForMessage(response, { pairedMethod: method })!.resolve(path);
    }

    it('marks `models` in a Cursor session/new response as removed, not unknown', () => {
        const messages = load('cursor-cli-2026.05.16.json');
        expect(resolveResponse(messages, 'session/new', ['result', 'models'])).toEqual({
            inSpec: false,
            isExtension: false,
            removedFromSpec: true,
        });
        expect(resolveResponse(messages, 'session/new', ['result', 'configOptions'])?.inSpec).toBe(
            true,
        );
    });

    it('marks the vars of a Codex env_var auth method as removed', () => {
        const messages = load('codex-acp-0.16.0.json');
        const authMethods = (
            messages.find((m) => m.kind === 'response' && m.raw.includes('"vars"'))!
                .payload as unknown as { result: { authMethods: Array<{ vars?: unknown }> } }
        ).result.authMethods;
        const i = authMethods.findIndex((a) => a.vars !== undefined);
        expect(
            resolveResponse(messages, 'initialize', ['result', 'authMethods', String(i), 'vars'])
                ?.removedFromSpec,
        ).toBe(true);
    });
});
