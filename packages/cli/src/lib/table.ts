import { type Styler, visibleWidth } from './style.js';

export type Align = 'left' | 'right';

export interface Column {
    title: string;
    align?: Align;
}

export interface TableOptions {
    indent?: string;
    gap?: string;
}

// Renders an aligned table with a dimmed header row and no borders. Cells may
// already carry ANSI codes — column widths are measured by visible width so
// colour never throws off alignment. Trailing padding is trimmed so piped
// output stays clean.
export function renderTable(
    s: Styler,
    columns: Column[],
    rows: string[][],
    opts: TableOptions = {},
): string {
    const indent = opts.indent ?? '';
    const gap = opts.gap ?? '  ';

    const widths = columns.map((col, c) =>
        Math.max(visibleWidth(col.title), ...rows.map((r) => visibleWidth(r[c] ?? ''))),
    );

    const pad = (text: string, width: number, align: Align): string => {
        const fill = ' '.repeat(Math.max(0, width - visibleWidth(text)));
        return align === 'right' ? fill + text : text + fill;
    };

    const lineFor = (cells: string[], color: (t: string) => string): string => {
        const rendered = columns.map((col, c) => {
            const align = col.align ?? 'left';
            const text = cells[c] ?? '';
            // Skip trailing padding on a left-aligned final column so piped
            // lines carry no trailing whitespace (and none gets trapped inside
            // an ANSI reset).
            const isLast = c === columns.length - 1;
            const cell = isLast && align === 'left' ? text : pad(text, widths[c]!, align);
            return color(cell);
        });
        return indent + rendered.join(gap);
    };

    const out: string[] = [];
    out.push(
        lineFor(
            columns.map((col) => col.title),
            (t) => s.dim(t),
        ),
    );
    for (const row of rows) {
        out.push(lineFor(row, (t) => t));
    }
    return out.map((l) => l + '\n').join('');
}
