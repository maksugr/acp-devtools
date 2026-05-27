import type { CapturedMessage, JsonRpcId } from './types.js';

export interface ClientInfo {
    name: string | null;
    title: string | null;
    version: string | null;
    platform: string | null;
}

export interface AgentInfo {
    name: string | null;
    version: string | null;
    authMethods: number;
}

export interface ClientCapabilities {
    fsReadTextFile: boolean;
    fsWriteTextFile: boolean;
    terminal: boolean;
    authTerminal: boolean;
    authGateway: boolean;
}

export interface AgentCapabilities {
    prompt: boolean;
    loadSession: boolean;
}

export interface RuntimeState {
    currentMode: string | null;
    modeChanges: number;
    currentModel: string | null;
    modelChanges: number;
    availableCommands: string[];
}

export interface EditorExtensions {
    jetbrainsProxyConfig: unknown | null;
}

export interface SessionMetadata {
    protocolVersion: number | null;
    client: ClientInfo;
    agent: AgentInfo;
    clientCapabilities: ClientCapabilities;
    agentCapabilities: AgentCapabilities;
    runtime: RuntimeState;
    extensions: EditorExtensions;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBool(value: unknown): boolean {
    return value === true;
}

function findInitializeRequest(messages: CapturedMessage[]): CapturedMessage | null {
    for (const m of messages) {
        if (
            m.kind === 'request' &&
            m.method === 'initialize' &&
            m.direction === 'editor-to-agent'
        ) {
            return m;
        }
    }
    return null;
}

function findInitializeResponse(
    messages: CapturedMessage[],
    requestRpcId: JsonRpcId | null | undefined,
): CapturedMessage | null {
    if (requestRpcId === null || requestRpcId === undefined) return null;
    for (const m of messages) {
        if (
            m.kind === 'response' &&
            m.direction === 'agent-to-editor' &&
            m.rpcId === requestRpcId
        ) {
            return m;
        }
    }
    return null;
}

function extractClient(initRequest: CapturedMessage | null): ClientInfo {
    const empty: ClientInfo = {
        name: null,
        title: null,
        version: null,
        platform: null,
    };
    if (!initRequest) return empty;
    const params = asRecord(asRecord(initRequest.payload)?.['params']);
    const clientInfo = asRecord(params?.['clientInfo']);
    if (!clientInfo) return empty;
    return {
        name: asString(clientInfo['name']),
        title: asString(clientInfo['title']),
        version: asString(clientInfo['version']),
        platform: asString(asRecord(clientInfo['_meta'])?.['platform']),
    };
}

function extractClientCapabilities(initRequest: CapturedMessage | null): ClientCapabilities {
    const empty: ClientCapabilities = {
        fsReadTextFile: false,
        fsWriteTextFile: false,
        terminal: false,
        authTerminal: false,
        authGateway: false,
    };
    if (!initRequest) return empty;
    const params = asRecord(asRecord(initRequest.payload)?.['params']);
    const caps = asRecord(params?.['clientCapabilities']);
    if (!caps) return empty;
    const fs = asRecord(caps['fs']);
    const auth = asRecord(caps['auth']);
    return {
        fsReadTextFile: asBool(fs?.['readTextFile']),
        fsWriteTextFile: asBool(fs?.['writeTextFile']),
        terminal: asBool(caps['terminal']),
        authTerminal: asBool(auth?.['terminal']),
        authGateway: asBool(asRecord(auth?.['_meta'])?.['gateway']),
    };
}

function extractAgent(initResponse: CapturedMessage | null): AgentInfo {
    const empty: AgentInfo = { name: null, version: null, authMethods: 0 };
    if (!initResponse) return empty;
    const result = asRecord(asRecord(initResponse.payload)?.['result']);
    if (!result) return empty;
    const agentInfo = asRecord(result['agentInfo']);
    const authMethodsArr = result['authMethods'];
    return {
        name: asString(agentInfo?.['name']),
        version: asString(agentInfo?.['version']),
        authMethods: Array.isArray(authMethodsArr) ? authMethodsArr.length : 0,
    };
}

function extractAgentCapabilities(initResponse: CapturedMessage | null): AgentCapabilities {
    const empty: AgentCapabilities = { prompt: false, loadSession: false };
    if (!initResponse) return empty;
    const result = asRecord(asRecord(initResponse.payload)?.['result']);
    const caps = asRecord(result?.['agentCapabilities']);
    if (!caps) return empty;
    return {
        prompt: asBool(caps['promptCapabilities']) || caps['promptCapabilities'] !== undefined,
        loadSession: asBool(caps['loadSession']),
    };
}

function extractProtocolVersion(
    initRequest: CapturedMessage | null,
    initResponse: CapturedMessage | null,
): number | null {
    const source = initResponse ?? initRequest;
    if (!source) return null;
    const root = asRecord(source.payload);
    const inner = asRecord(root?.['result']) ?? asRecord(root?.['params']);
    const v = inner?.['protocolVersion'];
    return typeof v === 'number' ? v : null;
}

function extractRuntime(messages: CapturedMessage[]): RuntimeState {
    let currentMode: string | null = null;
    let modeChanges = 0;
    let currentModel: string | null = null;
    let modelChanges = 0;
    let availableCommands: string[] = [];
    for (const m of messages) {
        if (m.direction !== 'editor-to-agent' && m.kind !== 'notification') {
            // session/set_mode and set_model can be either notification or request
            // depending on agent; we accept anything that carries the method.
        }
        const params = asRecord(asRecord(m.payload)?.['params']);
        if (!params) continue;
        if (m.method === 'session/set_mode') {
            const id = asString(params['modeId']);
            if (id !== null) {
                if (currentMode !== null && currentMode !== id) modeChanges += 1;
                currentMode = id;
            }
        } else if (m.method === 'session/set_model') {
            const id = asString(params['modelId']);
            if (id !== null) {
                if (currentModel !== null && currentModel !== id) modelChanges += 1;
                currentModel = id;
            }
        } else if (m.method === 'session/update') {
            const update = asRecord(params['update']);
            if (update?.['sessionUpdate'] === 'available_commands_update') {
                const cmds = update['availableCommands'];
                if (Array.isArray(cmds)) {
                    const names: string[] = [];
                    for (const c of cmds) {
                        const name = asString(asRecord(c)?.['name']);
                        if (name !== null) names.push(name);
                    }
                    if (names.length > 0) availableCommands = names;
                }
            } else if (update?.['sessionUpdate'] === 'current_mode_update') {
                const id = asString(update['currentModeId']);
                if (id !== null) {
                    if (currentMode !== null && currentMode !== id) modeChanges += 1;
                    currentMode = id;
                }
            }
        }
    }
    return { currentMode, modeChanges, currentModel, modelChanges, availableCommands };
}

function extractExtensions(initRequest: CapturedMessage | null): EditorExtensions {
    if (!initRequest) return { jetbrainsProxyConfig: null };
    const root = asRecord(initRequest.payload);
    const params = asRecord(root?.['params']);
    const meta = asRecord(params?.['_meta']);
    const proxyConfig = meta?.['proxyConfig'] ?? null;
    return { jetbrainsProxyConfig: proxyConfig };
}

/**
 * Pull all derived metadata from a session's captured messages. Pure — does
 * not touch the DB. The UI calls this each time `messages` mutates in a
 * meaningful way (initialize lands, set_mode/set_model fire,
 * available_commands_update broadcasts). The CLI calls it once on a saved
 * session for the `session-info` subcommand.
 */
export function extractSessionMetadata(messages: CapturedMessage[]): SessionMetadata {
    const initReq = findInitializeRequest(messages);
    const initRsp = findInitializeResponse(messages, initReq?.rpcId);
    return {
        protocolVersion: extractProtocolVersion(initReq, initRsp),
        client: extractClient(initReq),
        agent: extractAgent(initRsp),
        clientCapabilities: extractClientCapabilities(initReq),
        agentCapabilities: extractAgentCapabilities(initRsp),
        runtime: extractRuntime(messages),
        extensions: extractExtensions(initReq),
    };
}
