// Parts of the ACP v1 schema that `@agentclientprotocol/sdk` 2.4.0 dropped —
// all of them unstable additions — but that agents built against older SDKs
// still send. Without this list the inspector would flag them as unknown
// fields, which reads as an agent bug; they get a neutral "removed from spec"
// mark instead. Frames carrying them still validate (the schemas are open).
//
// Transitional: the list is removed in `until`, see
// https://github.com/maksugr/acp-devtools/issues/26. A test fails once the
// version reaches it.
//
// Field paths are relative to the message's params/result, `[]` stands for
// any array item, and a path covers everything below it.

export const REMOVED_FROM_SPEC = {
    until: '0.9.0',
    v1: {
        methods: [
            'document/didChange',
            'document/didClose',
            'document/didFocus',
            'document/didOpen',
            'document/didSave',
            'mcp/connect',
            'mcp/disconnect',
            'nes/accept',
            'nes/close',
            'nes/reject',
            'nes/start',
            'nes/suggest',
            'session/set_model',
        ] as readonly string[],
        fields: {
            InitializeRequest: ['clientCapabilities.nes', 'clientCapabilities.positionEncodings'],
            InitializeResponse: [
                'agentCapabilities.nes',
                'agentCapabilities.positionEncoding',
                'authMethods[].link',
                'authMethods[].vars',
            ],
            NewSessionRequest: ['mcpServers[].id'],
            NewSessionResponse: ['models'],
            LoadSessionRequest: ['mcpServers[].id'],
            LoadSessionResponse: ['models'],
            ForkSessionRequest: ['mcpServers[].id'],
            ForkSessionResponse: ['models'],
            ResumeSessionRequest: ['mcpServers[].id'],
            ResumeSessionResponse: ['models'],
            PromptRequest: ['messageId'],
            PromptResponse: ['userMessageId'],
            ListProvidersResponse: ['providers[].id'],
            MessageMcpRequest: ['connectionId'],
            MessageMcpNotification: ['connectionId'],
        } as Readonly<Record<string, readonly string[]>>,
    },
} as const;

/** True when `method` was part of the protocol version's schema before it was removed. */
export function isRemovedFromSpecMethod(method: string | null | undefined, protocolVersion = 1) {
    return protocolVersion === 1 && !!method && REMOVED_FROM_SPEC.v1.methods.includes(method);
}

/**
 * True when `path` (segments below params/result, array indices as numbers)
 * is, or lies under, a field the schema for `typeName` dropped.
 */
export function isRemovedFromSpecField(
    typeName: string,
    path: readonly string[],
    protocolVersion = 1,
): boolean {
    if (protocolVersion !== 1) return false;
    const removed = REMOVED_FROM_SPEC.v1.fields[typeName];
    if (!removed) return false;
    const key = path.map((s, i) => (/^\d+$/.test(s) ? '[]' : i === 0 ? s : `.${s}`)).join('');
    return removed.some((p) => key === p || key.startsWith(`${p}.`) || key.startsWith(`${p}[]`));
}
