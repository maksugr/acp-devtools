// Pure validator factory — accepts a schema object and returns an
// environment-agnostic `validateAcpMessage` function. Lives separately from
// `validate.ts` so the Node entry point (CLI) can load the schema via
// `createRequire` and the browser entry point (UI) can use Vite's native
// JSON-import — same factory either way.

import Ajv2020Import, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import type { CapturedMessage } from './types.js';

interface AjvOptions {
    strict?: boolean | 'log';
    allErrors?: boolean;
    validateFormats?: boolean;
}
interface AjvInstance {
    addSchema(s: object, id: string): AjvInstance;
    compile(s: object): ValidateFunction;
}
type AjvCtor = new (opts?: AjvOptions) => AjvInstance;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ajvModule = Ajv2020Import as any;
const Ajv2020: AjvCtor = (ajvModule.default ?? ajvModule) as AjvCtor;

export interface ValidationError {
    path: string;
    message: string;
    keyword?: string;
}

/**
 * A non-fatal note about a frame that is valid under the *current* schema but
 * omits a field the spec says will become mandatory. The signal is the
 * schema's own property description (`"…this will be required."`) — see
 * {@link createAcpValidator}. Kept separate from {@link ValidationError} so a
 * frame can be `valid: true` and still carry advisories.
 */
export interface ValidationAdvisory {
    /** The omitted field, relative to the method payload (e.g. `agentInfo`). */
    path: string;
    message: string;
    kind: 'soon-required';
}

export type ValidationSkipReason =
    | 'parse-error'
    | 'no-method'
    | 'unknown-method'
    | 'no-schema-for-kind'
    | 'wrong-kind';

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    /**
     * Soon-required fields the frame omits. Empty/absent for conforming
     * frames. Present even when `valid` is `true` — these never affect `valid`.
     */
    advisories?: ValidationAdvisory[];
    skipped?: ValidationSkipReason;
    schemaName?: string;
}

export interface ValidateOptions {
    pairedMethod?: string;
}

export interface AcpValidator {
    validateAcpMessage(msg: CapturedMessage, opts?: ValidateOptions): ValidationResult;
    knownAcpMethods(): string[];
}

interface MethodSlots {
    requestDef?: string;
    responseDef?: string;
    notificationDef?: string;
}

interface SchemaProperty {
    description?: string;
}

interface SchemaDef {
    'x-method'?: unknown;
    properties?: Record<string, SchemaProperty>;
}

interface SchemaShape {
    $defs?: Record<string, SchemaDef>;
}

const SCHEMA_ID = 'acp';

// The spec marks a field that is optional today but slated to become
// mandatory with this exact phrasing in its description (e.g. `agentInfo`,
// `clientInfo`). Matching the description rather than a hardcoded field list
// means new such fields are picked up automatically when the SDK schema bumps.
const SOON_REQUIRED_RE = /will be required/i;

function toError(e: ErrorObject): ValidationError {
    const v: ValidationError = {
        path: e.instancePath || '/',
        message: e.message ?? 'validation failed',
    };
    if (e.keyword) v.keyword = e.keyword;
    return v;
}

/**
 * Build a validator bound to the given ACP schema. The factory compiles
 * per-def validators lazily on first use so initial cost is just an ajv
 * instance plus the schema add.
 *
 * Caller is responsible for sourcing the schema — Node entry points use
 * `createRequire` (`validate.ts`); browser entry points let Vite handle the
 * JSON import (`validate-browser.ts`).
 */
export function createAcpValidator(schema: SchemaShape): AcpValidator {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    ajv.addSchema(schema as object, SCHEMA_ID);

    const methodIndex = new Map<string, MethodSlots>();
    // defName → list of fields whose description marks them soon-required.
    const softRequired = new Map<string, string[]>();
    const defs = schema.$defs ?? {};
    for (const [name, def] of Object.entries(defs)) {
        const soon = Object.entries(def.properties ?? {})
            .filter(([, prop]) => SOON_REQUIRED_RE.test(prop.description ?? ''))
            .map(([field]) => field);
        if (soon.length > 0) softRequired.set(name, soon);

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

    const compiled = new Map<string, ValidateFunction>();
    const getValidator = (defName: string): ValidateFunction => {
        const cached = compiled.get(defName);
        if (cached) return cached;
        const fresh = ajv.compile({ $ref: `${SCHEMA_ID}#/$defs/${defName}` });
        compiled.set(defName, fresh);
        return fresh;
    };

    function validateAcpMessage(
        msg: CapturedMessage,
        opts: ValidateOptions = {},
    ): ValidationResult {
        if (!msg.payload) return { valid: true, errors: [], skipped: 'parse-error' };
        if (msg.kind === 'unknown') return { valid: true, errors: [], skipped: 'wrong-kind' };

        const method = msg.method ?? opts.pairedMethod;
        if (!method) return { valid: true, errors: [], skipped: 'no-method' };

        const slots = methodIndex.get(method);
        if (!slots) return { valid: true, errors: [], skipped: 'unknown-method' };

        let defName: string | undefined;
        let target: unknown;
        const payload = msg.payload as { params?: unknown; result?: unknown };
        if (msg.kind === 'request') {
            defName = slots.requestDef;
            target = payload.params;
        } else if (msg.kind === 'notification') {
            defName = slots.notificationDef;
            target = payload.params;
        } else if (msg.kind === 'response') {
            defName = slots.responseDef;
            target = payload.result;
        } else {
            // 'error' frames carry a JSON-RPC envelope, not an ACP-method-specific shape.
            return { valid: true, errors: [], skipped: 'wrong-kind' };
        }
        if (!defName) return { valid: true, errors: [], skipped: 'no-schema-for-kind' };

        const advisories = collectAdvisories(defName, target);
        const validator = getValidator(defName);
        const ok = validator(target);
        const base: ValidationResult = ok
            ? { valid: true, errors: [], schemaName: defName }
            : {
                  valid: false,
                  errors: (validator.errors ?? []).map(toError),
                  schemaName: defName,
              };
        if (advisories.length > 0) base.advisories = advisories;
        return base;
    }

    function collectAdvisories(defName: string, target: unknown): ValidationAdvisory[] {
        const fields = softRequired.get(defName);
        if (!fields || typeof target !== 'object' || target === null) return [];
        const obj = target as Record<string, unknown>;
        const out: ValidationAdvisory[] = [];
        for (const field of fields) {
            // Absent key or explicit null both mean "no value provided" — for
            // `agentInfo`/`clientInfo` the schema permits null today, but it
            // carries no name/version, which is the whole point of the field.
            if (obj[field] === undefined || obj[field] === null) {
                out.push({
                    path: field,
                    message: `missing ${field} — will be required in a future ACP version`,
                    kind: 'soon-required',
                });
            }
        }
        return out;
    }

    function knownAcpMethods(): string[] {
        return [...methodIndex.keys()].sort();
    }

    return { validateAcpMessage, knownAcpMethods };
}
