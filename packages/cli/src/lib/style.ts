// Zero-dependency ANSI styling. Every styler function is a no-op when colour
// is disabled, so call sites stay branch-free. Colour detection follows the
// de-facto standard: FORCE_COLOR overrides, then NO_COLOR disables, then TTY.

const ESC = String.fromCharCode(27);

const CODES = {
    reset: 0,
    bold: 1,
    dim: 2,
    italic: 3,
    underline: 4,
    red: 31,
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    gray: 90,
} as const;

type Code = keyof typeof CODES;

interface ColorEnv {
    NO_COLOR?: string;
    FORCE_COLOR?: string;
}

export function colorEnabled(
    stream: { isTTY?: boolean } = process.stdout,
    env: ColorEnv = process.env,
): boolean {
    if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') return false;
    if (env.FORCE_COLOR !== undefined) return true;
    if (env.NO_COLOR !== undefined) return false;
    return Boolean(stream.isTTY);
}

export interface Styler {
    readonly enabled: boolean;
    bold(s: string): string;
    dim(s: string): string;
    italic(s: string): string;
    underline(s: string): string;
    red(s: string): string;
    green(s: string): string;
    yellow(s: string): string;
    blue(s: string): string;
    magenta(s: string): string;
    cyan(s: string): string;
    gray(s: string): string;
}

function paint(enabled: boolean, code: Code, s: string): string {
    if (!enabled) return s;
    return `${ESC}[${CODES[code]}m${s}${ESC}[${CODES.reset}m`;
}

export function createStyler(enabled: boolean = colorEnabled()): Styler {
    const wrap = (code: Code) => (s: string) => paint(enabled, code, s);
    return {
        enabled,
        bold: wrap('bold'),
        dim: wrap('dim'),
        italic: wrap('italic'),
        underline: wrap('underline'),
        red: wrap('red'),
        green: wrap('green'),
        yellow: wrap('yellow'),
        blue: wrap('blue'),
        magenta: wrap('magenta'),
        cyan: wrap('cyan'),
        gray: wrap('gray'),
    };
}

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

export function stripAnsi(s: string): string {
    return s.replace(ANSI_PATTERN, '');
}

export function visibleWidth(s: string): number {
    return stripAnsi(s).length;
}
