/** @type {import('tailwindcss').Config} */
const tokenColor = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Manrope"', 'system-ui', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                display: ['"Major Mono Display"', '"JetBrains Mono"', 'monospace'],
            },
            colors: {
                surface: {
                    base: tokenColor('surface-base'),
                    elev: tokenColor('surface-elev'),
                    row: tokenColor('surface-row'),
                    rowHover: tokenColor('surface-row-hover'),
                    sticky: tokenColor('surface-sticky'),
                },
                line: {
                    DEFAULT: tokenColor('line'),
                    strong: tokenColor('line-strong'),
                    grid: tokenColor('line-grid'),
                },
                ink: {
                    primary: tokenColor('ink-primary'),
                    secondary: tokenColor('ink-secondary'),
                    muted: tokenColor('ink-muted'),
                    dim: tokenColor('ink-dim'),
                },
                accent: {
                    out: tokenColor('accent-out'),
                    in: tokenColor('accent-in'),
                    error: tokenColor('accent-error'),
                    note: tokenColor('accent-note'),
                    info: tokenColor('accent-info'),
                    warn: tokenColor('accent-warn'),
                    ok: tokenColor('accent-ok'),
                },
            },
            boxShadow: {
                'inset-line': 'inset 0 -1px 0 0 rgba(255,255,255,0.04)',
            },
            animation: {
                'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
                scan: 'scan 1.6s linear infinite',
                'enter-row': 'enter-row 240ms cubic-bezier(.2,.7,.2,1)',
            },
            keyframes: {
                'pulse-soft': {
                    '0%, 100%': { opacity: '0.55' },
                    '50%': { opacity: '1' },
                },
                scan: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(120%)' },
                },
                'enter-row': {
                    '0%': { opacity: '0', transform: 'translateX(-6px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
            },
        },
    },
    plugins: [],
};
