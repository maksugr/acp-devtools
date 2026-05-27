import type { CapturedMessage } from '../acp/types.js';
import type { Session, SessionRecord } from './session.js';

export const EXPORT_VERSION = 1;

export interface ExportToolInfo {
    name: string;
    version: string;
}

export interface SessionExport {
    version: typeof EXPORT_VERSION;
    exportedAt: number;
    tool: ExportToolInfo;
    session: {
        id: number;
        name: string | null;
        agentCommand: string | null;
        clientName: string | null;
        startedAt: number;
        endedAt: number | null;
    };
    messages: CapturedMessage[];
}

export interface ExportSessionOptions {
    tool: ExportToolInfo;
    exportedAt?: number;
}

export function exportSession(session: Session, options: ExportSessionOptions): SessionExport {
    return exportSessionFromParts(session.info, session.messages(), options);
}

export function exportSessionFromParts(
    info: SessionRecord,
    messages: Iterable<CapturedMessage>,
    options: ExportSessionOptions,
): SessionExport {
    return {
        version: EXPORT_VERSION,
        exportedAt: options.exportedAt ?? Date.now(),
        tool: { name: options.tool.name, version: options.tool.version },
        session: {
            id: info.id,
            name: info.name,
            agentCommand: info.agentCommand,
            clientName: info.clientName,
            startedAt: info.startedAt,
            endedAt: info.endedAt,
        },
        messages: [...messages],
    };
}

export function serializeExport(exp: SessionExport, indent: number = 4): string {
    return JSON.stringify(exp, null, indent) + '\n';
}

export class ExportParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExportParseError';
    }
}

/**
 * Parse and validate a `SessionExport` JSON document. Throws `ExportParseError`
 * with a human-readable message on the first structural problem. The point is
 * to fail fast at load time so mock-replay never has to defend against half-
 * shaped frames.
 */
export function parseExport(input: string): SessionExport {
    let raw: unknown;
    try {
        raw = JSON.parse(input);
    } catch (err) {
        throw new ExportParseError(
            `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!isObject(raw)) throw new ExportParseError('expected an object at the top level');

    const version = raw.version;
    if (version !== EXPORT_VERSION) {
        throw new ExportParseError(
            `unsupported export version ${String(version)} (expected ${EXPORT_VERSION})`,
        );
    }

    const exportedAt = raw.exportedAt;
    if (typeof exportedAt !== 'number') throw new ExportParseError('exportedAt must be a number');

    if (!isObject(raw.tool)) throw new ExportParseError('tool must be an object');
    const toolName = raw.tool.name;
    const toolVersion = raw.tool.version;
    if (typeof toolName !== 'string') throw new ExportParseError('tool.name must be a string');
    if (typeof toolVersion !== 'string') throw new ExportParseError('tool.version must be a string');

    const session = raw.session;
    if (!isObject(session)) throw new ExportParseError('session must be an object');
    if (typeof session.id !== 'number') throw new ExportParseError('session.id must be a number');
    if (typeof session.startedAt !== 'number') {
        throw new ExportParseError('session.startedAt must be a number');
    }
    if (session.endedAt !== null && typeof session.endedAt !== 'number') {
        throw new ExportParseError('session.endedAt must be a number or null');
    }
    if (session.name !== null && typeof session.name !== 'string') {
        throw new ExportParseError('session.name must be a string or null');
    }
    if (session.agentCommand !== null && typeof session.agentCommand !== 'string') {
        throw new ExportParseError('session.agentCommand must be a string or null');
    }
    if (session.clientName !== null && typeof session.clientName !== 'string') {
        throw new ExportParseError('session.clientName must be a string or null');
    }

    if (!Array.isArray(raw.messages)) throw new ExportParseError('messages must be an array');
    const messages = raw.messages.map((msg, idx) => parseMessage(msg, idx));

    return {
        version: EXPORT_VERSION,
        exportedAt,
        tool: { name: toolName, version: toolVersion },
        session: {
            id: session.id,
            name: session.name,
            agentCommand: session.agentCommand,
            clientName: session.clientName,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
        },
        messages,
    };
}

function parseMessage(raw: unknown, idx: number): CapturedMessage {
    if (!isObject(raw)) throw new ExportParseError(`messages[${idx}] must be an object`);
    if (typeof raw.seq !== 'number') {
        throw new ExportParseError(`messages[${idx}].seq must be a number`);
    }
    if (typeof raw.timestamp !== 'number') {
        throw new ExportParseError(`messages[${idx}].timestamp must be a number`);
    }
    if (raw.direction !== 'editor-to-agent' && raw.direction !== 'agent-to-editor') {
        throw new ExportParseError(
            `messages[${idx}].direction must be 'editor-to-agent' or 'agent-to-editor'`,
        );
    }
    const kind = raw.kind;
    if (
        kind !== 'request' &&
        kind !== 'response' &&
        kind !== 'error' &&
        kind !== 'notification' &&
        kind !== 'unknown'
    ) {
        throw new ExportParseError(`messages[${idx}].kind has unexpected value '${String(kind)}'`);
    }
    if (typeof raw.raw !== 'string') {
        throw new ExportParseError(`messages[${idx}].raw must be a string`);
    }
    const msg: CapturedMessage = {
        seq: raw.seq,
        timestamp: raw.timestamp,
        direction: raw.direction,
        kind,
        raw: raw.raw,
        payload: raw.payload === null ? null : (raw.payload as CapturedMessage['payload']),
    };
    if (typeof raw.method === 'string') msg.method = raw.method;
    if (typeof raw.rpcId === 'string' || typeof raw.rpcId === 'number' || raw.rpcId === null) {
        msg.rpcId = raw.rpcId;
    }
    if (typeof raw.parseError === 'string') msg.parseError = raw.parseError;
    return msg;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
