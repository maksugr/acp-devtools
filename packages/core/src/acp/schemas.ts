// The ACP JSON schemas acp-devtools reads frames with, one per protocol
// version, from `@agentclientprotocol/sdk`. Imported statically so every
// consumer — Node, the tsup-bundled CLI and the Vite-built UI — embeds the
// same schema at build time, and the published CLI needs no runtime
// dependency on the SDK.
//
// These are the `unstable` variants: a superset of the stable schema that
// also covers methods and union variants not yet stabilised (`session/fork`,
// `subagent_update`, …). Agents already send those, and reading them with
// the stable schema would report valid frames as violations. Neither variant
// closes objects, so fields the schema doesn't know are allowed either way.

import v1 from '@agentclientprotocol/sdk/schema/v1/schema.unstable.json' with { type: 'json' };
import v2 from '@agentclientprotocol/sdk/schema/v2/schema.unstable.json' with { type: 'json' };
import type { AcpProtocolVersion } from './protocol-version.js';

export const ACP_SCHEMAS: Readonly<Record<AcpProtocolVersion, object>> = {
    1: v1 as object,
    2: v2 as object,
};
