import { describe, expect, it } from 'vitest';
import { colorEnabled, createStyler, stripAnsi, visibleWidth } from './style.js';

describe('colorEnabled', () => {
    it('disables when FORCE_COLOR=0', () => {
        expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: '0' })).toBe(false);
    });

    it('enables when FORCE_COLOR is set to a truthy value, even without a TTY', () => {
        expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    });

    it('disables when NO_COLOR is present regardless of value', () => {
        expect(colorEnabled({ isTTY: true }, { NO_COLOR: '' })).toBe(false);
        expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    });

    it('lets FORCE_COLOR win over NO_COLOR', () => {
        expect(colorEnabled({ isTTY: false }, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(true);
    });

    it('falls back to the stream TTY flag', () => {
        expect(colorEnabled({ isTTY: true }, {})).toBe(true);
        expect(colorEnabled({ isTTY: false }, {})).toBe(false);
        expect(colorEnabled({}, {})).toBe(false);
    });
});

describe('createStyler', () => {
    it('wraps text in ANSI codes when enabled', () => {
        const s = createStyler(true);
        expect(s.bold('x')).toBe('\x1b[1mx\x1b[0m');
        expect(s.green('x')).toBe('\x1b[32mx\x1b[0m');
    });

    it('is a no-op when disabled', () => {
        const s = createStyler(false);
        expect(s.bold('x')).toBe('x');
        expect(s.cyan('y')).toBe('y');
        expect(s.enabled).toBe(false);
    });
});

describe('stripAnsi / visibleWidth', () => {
    it('removes colour codes and measures the visible length', () => {
        const colored = createStyler(true).bold('hello');
        expect(stripAnsi(colored)).toBe('hello');
        expect(visibleWidth(colored)).toBe(5);
    });
});
