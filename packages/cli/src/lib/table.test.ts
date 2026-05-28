import { describe, expect, it } from 'vitest';
import { createStyler } from './style.js';
import { renderTable, type Column } from './table.js';

const plain = createStyler(false);
const columns: Column[] = [
    { title: 'ID', align: 'left' },
    { title: 'MSGS', align: 'right' },
    { title: 'LABEL', align: 'left' },
];

describe('renderTable', () => {
    it('emits a header row followed by aligned rows', () => {
        const out = renderTable(plain, columns, [
            ['#1', '5', 'alpha'],
            ['#22', '1280', 'beta'],
        ]);
        const lines = out.trimEnd().split('\n');
        expect(lines[0]).toBe('ID   MSGS  LABEL');
        // ID column padded to width 3 (#22); MSGS right-aligned to width 4.
        expect(lines[1]).toBe('#1      5  alpha');
        expect(lines[2]).toBe('#22  1280  beta');
    });

    it('leaves no trailing whitespace on a left-aligned final column', () => {
        const out = renderTable(plain, columns, [['#1', '5', 'x']]);
        for (const line of out.split('\n')) {
            expect(line).toBe(line.replace(/\s+$/, ''));
        }
    });

    it('measures width by visible text so colour does not break alignment', () => {
        const colored = createStyler(true);
        const out = renderTable(colored, columns, [
            [colored.cyan('#1'), '5', 'alpha'],
            ['#22', '1280', 'beta'],
        ]);
        const lines = out.trimEnd().split('\n');
        // Strip ANSI and confirm the columns still line up.
        const stripped = lines.map((l) => l.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ''));
        expect(stripped[1]).toBe('#1      5  alpha');
        expect(stripped[2]).toBe('#22  1280  beta');
    });

    it('respects a custom indent', () => {
        const out = renderTable(plain, columns, [['#1', '5', 'x']], { indent: '  ' });
        expect(out.split('\n')[0]).toBe('  ID  MSGS  LABEL');
    });
});
