import { describe, expect, it } from 'vitest';
import { LineFramer, parseFrame } from './parser.js';

describe('LineFramer', () => {
    it('splits a single chunk on newlines', () => {
        const framer = new LineFramer();
        expect(framer.feed('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
        expect(framer.flush()).toBeNull();
    });

    it('buffers partial lines across chunks', () => {
        const framer = new LineFramer();
        expect(framer.feed('hel')).toEqual([]);
        expect(framer.feed('lo\nwor')).toEqual(['hello']);
        expect(framer.feed('ld\n')).toEqual(['world']);
    });

    it('strips trailing carriage return', () => {
        const framer = new LineFramer();
        expect(framer.feed('crlf\r\n')).toEqual(['crlf']);
    });

    it('skips empty lines', () => {
        const framer = new LineFramer();
        expect(framer.feed('\n\nx\n')).toEqual(['x']);
    });

    it('flushes an unterminated tail', () => {
        const framer = new LineFramer();
        framer.feed('partial');
        expect(framer.flush()).toBe('partial');
        expect(framer.flush()).toBeNull();
    });
});

describe('parseFrame', () => {
    it('classifies a request', () => {
        const f = parseFrame('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
        expect(f.kind).toBe('request');
        expect(f.method).toBe('initialize');
        expect(f.rpcId).toBe(1);
        expect(f.payload).not.toBeNull();
    });

    it('classifies a notification', () => {
        const f = parseFrame('{"jsonrpc":"2.0","method":"session/cancel","params":{}}');
        expect(f.kind).toBe('notification');
        expect(f.method).toBe('session/cancel');
        expect(f.rpcId).toBeUndefined();
    });

    it('classifies a success response', () => {
        const f = parseFrame('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}');
        expect(f.kind).toBe('response');
        expect(f.rpcId).toBe(7);
    });

    it('classifies an error response', () => {
        const f = parseFrame(
            '{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"not found"}}',
        );
        expect(f.kind).toBe('error');
        expect(f.rpcId).toBe(7);
    });

    it('reports invalid JSON', () => {
        const f = parseFrame('{not json}');
        expect(f.kind).toBe('unknown');
        expect(f.payload).toBeNull();
        expect(f.parseError).toMatch(/invalid JSON/);
    });

    it('rejects non-JSON-RPC objects', () => {
        const f = parseFrame('{"hello":"world"}');
        expect(f.kind).toBe('unknown');
        expect(f.parseError).toMatch(/not a JSON-RPC/);
    });
});
