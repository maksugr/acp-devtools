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

export type ValidationSkipReason =
    | 'parse-error'
    | 'no-method'
    | 'unknown-method'
    | 'no-schema-for-kind'
    | 'wrong-kind';

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
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

interface SchemaDef {
    'x-method'?: unknown;
}

interface SchemaShape {
    $defs?: Record<string, SchemaDef>;
}

const SCHEMA_ID = 'acp';

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
    const defs = schema.$defs ?? {};
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

        const validator = getValidator(defName);
        const ok = validator(target);
        if (ok) return { valid: true, errors: [], schemaName: defName };
        return {
            valid: false,
            errors: (validator.errors ?? []).map(toError),
            schemaName: defName,
        };
    }

    function knownAcpMethods(): string[] {
        return [...methodIndex.keys()].sort();
    }

    return { validateAcpMessage, knownAcpMethods };
}
