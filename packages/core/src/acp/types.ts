export type JsonRpcId = string | number;

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface JsonRpcSuccessResponse {
    jsonrpc: '2.0';
    id: JsonRpcId | null;
    result: unknown;
}

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcErrorResponse {
    jsonrpc: '2.0';
    id: JsonRpcId | null;
    error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type MessageDirection = 'editor-to-agent' | 'agent-to-editor';
export type MessageKind = 'request' | 'response' | 'error' | 'notification' | 'unknown';

export interface CapturedMessage {
    /** Monotonic id assigned by the proxy, unique within a session. */
    seq: number;
    /** Unix timestamp in milliseconds when the line was captured. */
    timestamp: number;
    /** Which way the message was flowing through the proxy. */
    direction: MessageDirection;
    /** JSON-RPC role of the message. `unknown` if parsing failed. */
    kind: MessageKind;
    /** JSON-RPC method (for requests and notifications). */
    method?: string;
    /** JSON-RPC id (for requests, success responses, and error responses). */
    rpcId?: JsonRpcId | null;
    /** The raw line as it appeared on the wire (no trailing newline). */
    raw: string;
    /** The parsed JSON payload, or `null` when parsing failed. */
    payload: JsonRpcMessage | null;
    /** Parse error string, if the line could not be decoded as JSON-RPC. */
    parseError?: string;
}
