// The ACP validator bound to the bundled schemas (see `schemas.ts`). Works
// unchanged in Node, the CLI bundle and the browser.

import { ACP_SCHEMAS } from './schemas.js';
import { createAcpValidator } from './validate-factory.js';

const validator = createAcpValidator(ACP_SCHEMAS);
export const validateAcpMessage = validator.validateAcpMessage;
export const validateMessages = validator.validateMessages;
export const knownAcpMethods = validator.knownAcpMethods;
export type {
    AcpValidator,
    ValidationError,
    ValidationAdvisory,
    ValidationResult,
    ValidationSkipReason,
    ValidateOptions,
} from './validate-factory.js';
