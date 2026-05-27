// Browser-side entry point for the ACP spec decoder. Vite's native JSON
// import resolves the schema at build time. Same pattern as
// `validate-browser.ts` — Node code paths must use `spec-decoder.ts` to
// avoid the `import ... with` attribute Vite parses but plain Node doesn't.

import schema from '@agentclientprotocol/sdk/schema/schema.json' with { type: 'json' };
import { createSpecDecoder } from './spec-decoder-factory.js';

const decoder = createSpecDecoder(
    schema as { $defs?: Record<string, { 'x-method'?: unknown }> },
);
export const resolveSpecForMessage = decoder.resolveForMessage;
export const knownAcpSpecMethods = decoder.knownMethods;
export type {
    AcpSpecDecoder,
    MessageSpecResolver,
    SpecInfo,
    ResolveMessageOptions,
} from './spec-decoder-factory.js';
