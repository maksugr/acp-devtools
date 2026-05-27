// Pure spec-decoder factory — accepts a schema object and returns an
// environment-agnostic resolver that maps `(message, path)` to schema
// metadata (description, type name, in-spec / extension flag). Used by the
// UI `JsonTree` for hover-tooltips and the `⚠ ext` badge.
//
// Same two-entry-point pattern as `validate-factory.ts`: Node uses
// `spec-decoder.ts` (createRequire), browser uses `spec-decoder-browser.ts`
// (Vite JSON import).

import type { CapturedMessage } from './types.js';

interface SchemaShape {
    $defs?: Record<string, SchemaDef>;
}

interface SchemaDef {
    description?: string;
    type?: string | string[];
    properties?: Record<string, SchemaNode>;
    additionalProperties?: boolean | SchemaNode;
    items?: SchemaNode;
    $ref?: string;
    allOf?: SchemaNode[];
    anyOf?: SchemaNode[];
    oneOf?: SchemaNode[];
    enum?: unknown[];
    'x-method'?: unknown;
    title?: string;
}

type SchemaNode = SchemaDef;

interface MethodSlots {
    requestDef?: string;
    responseDef?: string;
    notificationDef?: string;
}

export interface SpecInfo {
    /** True when the path resolved to a known field in the ACP schema. */
    inSpec: boolean;
    /**
     * True when the path traverses an `_meta` field anywhere in its ancestry —
     * by ACP convention, anything under `_meta` is an extension whose shape
     * the spec does not constrain.
     */
    isExtension: boolean;
    /** Optional schema description for this field (single-line, may be Markdown). */
    description?: string;
    /**
     * Best-effort type name. For primitive types this is `"string"`,
     * `"number"`, etc.; for `$ref`-typed fields it is the def name (e.g.
     * `"ClientCapabilities"`); for arrays it is `"array"`.
     */
    type?: string;
    /** Enum allowed values, when the schema constrains this field. */
    enumValues?: unknown[];
}

export interface MessageSpecResolver {
    /** Schema def name for the message envelope (e.g. `"InitializeRequest"`). */
    typeName: string;
    /** Description from the schema def (single sentence + protocol-docs link). */
    typeDescription: string | null;
    /**
     * Resolve a path within the **payload root**. The first segment is
     * normally one of `params`, `result`, or `error` — the resolver strips
     * the envelope key automatically and walks the ACP schema.
     */
    resolve(path: string[]): SpecInfo | null;
}

export interface ResolveMessageOptions {
    /** When this message is a response or error, the paired request's method. */
    pairedMethod?: string;
}

export interface AcpSpecDecoder {
    resolveForMessage(
        message: CapturedMessage,
        opts?: ResolveMessageOptions,
    ): MessageSpecResolver | null;
    /** Sorted list of every method known to the schema (for diagnostics). */
    knownMethods(): string[];
}

/**
 * Build a spec decoder bound to the given ACP schema. The factory builds the
 * `method → def` index up-front; per-field lookups are linear in the path
 * length and effectively O(1) amortised (≤5 segments in practice).
 */
export function createSpecDecoder(schema: SchemaShape): AcpSpecDecoder {
    const defs = schema.$defs ?? {};
    const methodIndex = new Map<string, MethodSlots>();
    for (const [name, def] of Object.entries(defs)) {
        const method = def['x-method'];
        if (typeof method !== 'string') continue;
        let slots = methodIndex.get(method);
        if (!slots) {
            slots = {};
            methodIndex.set(method, slots);
        }
        if (name.endsWith('Request')) slots.requestDef = name;
        else if (name.endsWith('Response')) slots.responseDef = name;
        else if (name.endsWith('Notification')) slots.notificationDef = name;
    }

    function pickDef(message: CapturedMessage, pairedMethod: string | undefined): string | null {
        switch (message.kind) {
            case 'request': {
                const m = message.method;
                if (!m) return null;
                return methodIndex.get(m)?.requestDef ?? null;
            }
            case 'notification': {
                const m = message.method;
                if (!m) return null;
                return methodIndex.get(m)?.notificationDef ?? null;
            }
            case 'response':
            case 'error': {
                // Responses don't carry their own method — we need the
                // paired request's method to pick the right def.
                if (!pairedMethod) return null;
                return methodIndex.get(pairedMethod)?.responseDef ?? null;
            }
            default:
                return null;
        }
    }

    function envelopeKey(kind: CapturedMessage['kind']): string | null {
        if (kind === 'request' || kind === 'notification') return 'params';
        if (kind === 'response') return 'result';
        if (kind === 'error') return 'error';
        return null;
    }

    function isPlainObject(v: unknown): v is Record<string, unknown> {
        return typeof v === 'object' && v !== null && !Array.isArray(v);
    }

    /**
     * Check if a value matches every `const`/`enum` discriminator declared on
     * a variant's properties. Handles JSON Schema "tagged union" patterns
     * like `{type: 'boolean', value: ...}` vs `{type: 'string', value: ...}`.
     */
    function discriminatorsMatch(variant: SchemaNode, value: Record<string, unknown>): boolean {
        const props = variant.properties;
        if (!props) return true;
        for (const [key, prop] of Object.entries(props)) {
            if (!prop || typeof prop !== 'object') continue;
            if ('const' in prop) {
                if (value[key] !== (prop as { const: unknown }).const) return false;
            } else if (Array.isArray(prop.enum)) {
                if (!prop.enum.includes(value[key])) return false;
            }
        }
        return true;
    }

    function variantMatchesValue(variant: SchemaNode, value: unknown): boolean {
        const type = variant.type;
        if (typeof type === 'string') {
            if (type === 'null') return value === null;
            if (type === 'string') return typeof value === 'string';
            if (type === 'boolean') return typeof value === 'boolean';
            if (type === 'number' || type === 'integer') return typeof value === 'number';
            if (type === 'array') return Array.isArray(value);
            if (type === 'object') {
                return isPlainObject(value) && discriminatorsMatch(variant, value);
            }
        }
        if (variant.$ref || variant.properties || variant.allOf) {
            return isPlainObject(value) && discriminatorsMatch(variant, value);
        }
        return false;
    }

    function resolveRef(
        node: SchemaNode | null | undefined,
        value: unknown = undefined,
    ): SchemaNode | null {
        if (!node) return null;
        if (node.$ref) {
            const refName = node.$ref.replace(/^#\/\$defs\//, '');
            const target = defs[refName];
            return target ? resolveRef(target, value) : null;
        }
        // `allOf` with a single $ref is the SDK's way of attaching descriptions
        // — collapse it for property lookup.
        if (node.allOf && node.allOf.length > 0) {
            const merged: SchemaNode = { properties: {} };
            for (const part of node.allOf) {
                const resolved = resolveRef(part, value);
                if (resolved?.properties) {
                    merged.properties = { ...merged.properties, ...resolved.properties };
                }
                if (resolved?.type && !merged.type) merged.type = resolved.type;
                if (resolved?.items && !merged.items) merged.items = resolved.items;
            }
            // Carry over node-level description if `allOf` wrapped it.
            if (node.description && !merged.description) merged.description = node.description;
            return merged;
        }
        if (node.anyOf || node.oneOf) {
            const variants = (node.anyOf ?? node.oneOf) as SchemaNode[];
            // When we have the actual value, disambiguate by JSON type — this
            // is what makes the `ⓘ` popover say STRING for a string and BOOLEAN
            // for a boolean instead of always picking the first variant.
            if (value !== undefined) {
                for (const v of variants) {
                    if (v.type === 'null') continue;
                    if (variantMatchesValue(v, value)) return resolveRef(v, value);
                }
            }
            // Fallback when no value (intermediate schema lookup) or no match:
            // first non-null wins.
            for (const v of variants) {
                if (v.type === 'null') continue;
                const resolved = resolveRef(v, value);
                if (resolved) return resolved;
            }
            return null;
        }
        return node;
    }

    function valueAtPath(root: unknown, path: string[]): unknown {
        let v: unknown = root;
        for (const seg of path) {
            if (v === null || v === undefined) return undefined;
            if (Array.isArray(v) && /^\d+$/.test(seg)) {
                v = v[Number(seg)];
            } else if (typeof v === 'object') {
                v = (v as Record<string, unknown>)[seg];
            } else {
                return undefined;
            }
        }
        return v;
    }

    function typeNameOf(node: SchemaNode | null | undefined): string | undefined {
        if (!node) return undefined;
        if (node.$ref) return node.$ref.replace(/^#\/\$defs\//, '');
        const t = node.type;
        if (typeof t === 'string') return t;
        if (Array.isArray(t)) {
            const nonNull = t.find((x) => x !== 'null');
            return nonNull;
        }
        return undefined;
    }

    function buildResolver(defName: string, rootValue: unknown): MessageSpecResolver {
        const def = defs[defName];
        return {
            typeName: defName,
            typeDescription: def?.description ?? null,
            resolve(path: string[]): SpecInfo | null {
                if (path.length === 0) {
                    return {
                        inSpec: true,
                        isExtension: false,
                        description: def?.description,
                        type: defName,
                    };
                }
                // Path includes envelope key — skip it. The envelope key
                // (params/result/error) is also where rootValue starts
                // descending from, so the value at path[0] is the payload's
                // params/result/error sub-object.
                const inner = path.slice(1);
                if (inner.length === 0) return null;

                let isExtension = false;
                let current: SchemaNode | null = def ?? null;
                for (let i = 0; i < inner.length; i++) {
                    const segment = inner[i]!;
                    if (segment === '_meta') isExtension = true;
                    const isIndex = /^\d+$/.test(segment);
                    // Disambiguate `current`'s shape using the value AT THIS
                    // depth — for example, when `current` is an array of
                    // (boolean | string) variants and the actual value is a
                    // string, we want the string variant.
                    const valueHere = valueAtPath(rootValue, path.slice(0, i + 1));
                    current = resolveRef(current, valueHere);
                    if (!current) return null;
                    if (isIndex) {
                        const itemValue = valueAtPath(rootValue, path.slice(0, i + 2));
                        current = resolveRef(current.items, itemValue);
                        continue;
                    }
                    if (isExtension && segment !== '_meta') {
                        return { inSpec: false, isExtension: true };
                    }
                    const next = current.properties?.[segment];
                    if (!next) return { inSpec: false, isExtension };
                    current = next;
                }
                // Terminal resolve — pass the actual value so unions surface
                // the correct variant's description/type.
                const finalValue = valueAtPath(rootValue, path);
                const resolved = resolveRef(current, finalValue);
                const info: SpecInfo = { inSpec: true, isExtension };
                if (current?.description) info.description = current.description;
                else if (resolved?.description) info.description = resolved.description;
                const type = typeNameOf(current ?? null) ?? typeNameOf(resolved);
                if (type) info.type = type;
                if (resolved?.enum) info.enumValues = resolved.enum;
                return info;
            },
        };
    }

    function resolveForMessage(
        message: CapturedMessage,
        opts: ResolveMessageOptions = {},
    ): MessageSpecResolver | null {
        const defName = pickDef(message, opts.pairedMethod);
        if (!defName) return null;
        const _envelope = envelopeKey(message.kind);
        if (!_envelope) return null;
        return buildResolver(defName, message.payload);
    }

    function knownMethods(): string[] {
        return [...methodIndex.keys()].sort();
    }

    return { resolveForMessage, knownMethods };
}
