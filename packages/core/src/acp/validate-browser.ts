// Browser-side entry point for the ACP validator. Vite handles
// `import x from 'foo.json'` natively (no `with { type: 'json' }` attribute
// needed and no Node-only `createRequire`). Do NOT import this file from
// the CLI / Node code paths — it would fail to resolve under plain Node ESM.

import schema from '@agentclientprotocol/sdk/schema/schema.json' with { type: 'json' };
import { createAcpValidator } from './validate-factory.js';

const validator = createAcpValidator(schema as { $defs?: Record<string, { 'x-method'?: unknown }> });
export const validateAcpMessage = validator.validateAcpMessage;
export const knownAcpMethods = validator.knownAcpMethods;
export type {
    AcpValidator,
    ValidationError,
    ValidationResult,
    ValidationSkipReason,
    ValidateOptions,
} from './validate-factory.js';
