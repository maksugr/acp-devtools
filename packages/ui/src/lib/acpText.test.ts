import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from '@acp-devtools/core';
import { extractTextPreview, isUserPrompt } from './acpText';

const mkMessage = (overrides: Partial<CapturedMessage> = {}): CapturedMessage => ({
    seq: 1,
    timestamp: 0,
    direction: 'editor-to-agent',
    kind: 'request',
    raw: '',
    payload: null,
    ...overrides,
});

describe('extractTextPreview', () => {
    it('joins text blocks of a session/prompt request', () => {
        const m = mkMessage({
            method: 'session/prompt',
            payload: {
                jsonrpc: '2.0',
                id: 5,
                method: 'session/prompt',
                params: {
                    prompt: [
                        { type: 'text', text: 'hello' },
                        { type: 'text', text: 'world' },
                        { type: 'image', uri: 'data:...' },
                    ],
                },
            } as unknown as CapturedMessage['payload'],
        });
        expect(extractTextPreview(m)).toBe('hello world');
    });
    it('returns null for a session/prompt with no text blocks', () => {
        const m = mkMessage({
            method: 'session/prompt',
            payload: {
                jsonrpc: '2.0',
                id: 5,
                method: 'session/prompt',
                params: { prompt: [{ type: 'image', uri: 'x' }] },
            } as unknown as CapturedMessage['payload'],
        });
        expect(extractTextPreview(m)).toBeNull();
    });
    it('pulls update.content.text from session/update', () => {
        const m = mkMessage({
            kind: 'notification',
            method: 'session/update',
            payload: {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                    update: {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: 'Hi there' },
                    },
                },
            } as unknown as CapturedMessage['payload'],
        });
        expect(extractTextPreview(m)).toBe('Hi there');
    });
    it('falls back to update.text when content.text is missing', () => {
        const m = mkMessage({
            kind: 'notification',
            method: 'session/update',
            payload: {
                jsonrpc: '2.0',
                method: 'session/update',
                params: { update: { sessionUpdate: 'agent_thought_chunk', text: 'thinking…' } },
            } as unknown as CapturedMessage['payload'],
        });
        expect(extractTextPreview(m)).toBe('thinking…');
    });
    it('returns null when payload is null', () => {
        expect(extractTextPreview(mkMessage({ payload: null }))).toBeNull();
    });
    it('returns null for unrelated methods', () => {
        expect(extractTextPreview(mkMessage({ method: 'fs/read_text_file' }))).toBeNull();
    });
});

describe('isUserPrompt', () => {
    it('matches request session/prompt only', () => {
        expect(
            isUserPrompt(mkMessage({ method: 'session/prompt', kind: 'request' })),
        ).toBe(true);
        expect(
            isUserPrompt(mkMessage({ method: 'session/prompt', kind: 'response' })),
        ).toBe(false);
        expect(isUserPrompt(mkMessage({ method: 'session/new', kind: 'request' }))).toBe(false);
    });
});
