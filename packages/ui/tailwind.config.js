/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Manrope"', 'system-ui', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                display: ['"Major Mono Display"', '"JetBrains Mono"', 'monospace'],
            },
            colors: {
                surface: {
                    base: '#0a0d12',
                    elev: '#10151c',
                    row: '#141a23',
                    rowHover: '#1a2130',
                    sticky: '#0d1118',
                },
                line: {
                    DEFAULT: '#1f2734',
                    strong: '#2c374a',
                    grid: '#161c26',
                },
                ink: {
                    primary: '#e6ebf2',
                    secondary: '#9aa3b3',
                    muted: '#5b6478',
                    dim: '#3d4555',
                },
                accent: {
                    out: '#3df0d0',
                    in: '#ff9d3f',
                    error: '#ff3d75',
                    note: '#a47cff',
                    info: '#6fb8ff',
                    warn: '#f5d76e',
                    ok: '#7cf08c',
                },
            },
            boxShadow: {
                'inset-line': 'inset 0 -1px 0 0 rgba(255,255,255,0.04)',
            },
            animation: {
                'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
                'scan': 'scan 1.6s linear infinite',
                'enter-row': 'enter-row 240ms cubic-bezier(.2,.7,.2,1)',
            },
            keyframes: {
                'pulse-soft': {
                    '0%, 100%': { opacity: '0.55' },
                    '50%': { opacity: '1' },
                },
                'scan': {
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
