// Node-side entry point for the ACP validator. Loads the schema via
// `createRequire` (the standard ESM-from-CJS escape hatch — works both in
// raw tsc output and inside the tsup-bundled CLI). For the browser bundle
// see `validate-browser.ts`, which uses Vite's native JSON loader.

import { createRequire } from 'node:module';
import { createAcpValidator } from './validate-factory.js';

const require = createRequire(import.meta.url);
const schema = require('@agentclientprotocol/sdk/schema/schema.json') as {
    $defs?: Record<string, { 'x-method'?: unknown }>;
};

const validator = createAcpValidator(schema);
export const validateAcpMessage = validator.validateAcpMessage;
export const knownAcpMethods = validator.knownAcpMethods;
export type {
    AcpValidator,
    ValidationError,
    ValidationResult,
    ValidationSkipReason,
    ValidateOptions,
} from './validate-factory.js';
