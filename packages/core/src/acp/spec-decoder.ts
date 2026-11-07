// The ACP spec decoder bound to the bundled schemas (see `schemas.ts`).
// Works unchanged in Node, the CLI bundle and the browser.

import { ACP_SCHEMAS } from './schemas.js';
import { createSpecDecoder } from './spec-decoder-factory.js';

const decoder = createSpecDecoder(ACP_SCHEMAS);
export const resolveSpecForMessage = decoder.resolveForMessage;
export const knownAcpSpecMethods = decoder.knownMethods;
export type {
    AcpSpecDecoder,
    MessageSpecResolver,
    SpecInfo,
    ResolveMessageOptions,
} from './spec-decoder-factory.js';
