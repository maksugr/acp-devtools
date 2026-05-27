// Node-side entry point for the ACP spec decoder. Loads the schema via
// `createRequire` (same trick as `validate.ts`). Browser uses
// `spec-decoder-browser.ts`.

import { createRequire } from 'node:module';
import { createSpecDecoder } from './spec-decoder-factory.js';

const require = createRequire(import.meta.url);
const schema = require('@agentclientprotocol/sdk/schema/schema.json') as {
    $defs?: Record<string, { 'x-method'?: unknown }>;
};

const decoder = createSpecDecoder(schema);
export const resolveSpecForMessage = decoder.resolveForMessage;
export const knownAcpSpecMethods = decoder.knownMethods;
export type {
    AcpSpecDecoder,
    MessageSpecResolver,
    SpecInfo,
    ResolveMessageOptions,
} from './spec-decoder-factory.js';
