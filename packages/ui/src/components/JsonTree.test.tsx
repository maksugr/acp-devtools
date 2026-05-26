import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonTree } from './JsonTree';

describe('JsonTree primitives', () => {
    it('renders null as the literal `null`', () => {
        render(<JsonTree value={null} />);
        expect(screen.getByText('null')).toBeInTheDocument();
    });

    it('renders strings JSON-quoted', () => {
        render(<JsonTree value="hello" />);
        expect(screen.getByText('"hello"')).toBeInTheDocument();
    });

    it('renders numbers and booleans verbatim', () => {
        render(<JsonTree value={42} />);
        expect(screen.getByText('42')).toBeInTheDocument();

        render(<JsonTree value={true} name="ok" />);
        expect(screen.getByText('true')).toBeInTheDocument();
        expect(screen.getByText('"ok":')).toBeInTheDocument();
    });

    it('renders an array index without quotes around the key', () => {
        render(<JsonTree value="item" name="2" />);
        // Numeric key renders without quote-wrapping
        expect(screen.getByText('2:')).toBeInTheDocument();
    });
});

describe('JsonTree expand / collapse', () => {
    it('renders a small object expanded by default and shows all keys', () => {
        render(<JsonTree value={{ a: 1, b: 2 }} />);
        // Visible "{" opener
        expect(screen.getAllByText('{').length).toBeGreaterThan(0);
        expect(screen.getByText('"a":')).toBeInTheDocument();
        expect(screen.getByText('"b":')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('collapses a large object by default and shows a `N keys` summary', () => {
        // COLLAPSE_THRESHOLD is 6, so 7 keys should collapse
        const big: Record<string, number> = {};
        for (let i = 0; i < 7; i++) big[`k${i}`] = i;
        render(<JsonTree value={big} />);
        expect(screen.getByText('7 keys')).toBeInTheDocument();
        // Keys themselves are not rendered while collapsed
        expect(screen.queryByText('"k0":')).toBeNull();
    });

    it('toggles open ↔ closed when the row is clicked', () => {
        render(<JsonTree value={{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }} />);
        // Initially collapsed (7 keys > threshold)
        expect(screen.getByText('7 keys')).toBeInTheDocument();
        // Toggle open
        fireEvent.click(screen.getByRole('button'));
        expect(screen.queryByText('7 keys')).toBeNull();
        expect(screen.getByText('"a":')).toBeInTheDocument();
        // Toggle closed again
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('7 keys')).toBeInTheDocument();
    });

    it('respects defaultExpanded=false even for tiny objects', () => {
        render(<JsonTree value={{ a: 1 }} defaultExpanded={false} />);
        expect(screen.getByText('1 keys')).toBeInTheDocument();
        expect(screen.queryByText('"a":')).toBeNull();
    });

    it('respects defaultExpanded=true even for deep objects', () => {
        const deep: Record<string, number> = {};
        for (let i = 0; i < 20; i++) deep[`k${i}`] = i;
        render(<JsonTree value={deep} defaultExpanded={true} />);
        expect(screen.queryByText('20 keys')).toBeNull();
        expect(screen.getByText('"k0":')).toBeInTheDocument();
    });

    it('renders arrays with `N items` summary when collapsed', () => {
        const arr = Array.from({ length: 10 }, (_, i) => i);
        render(<JsonTree value={arr} />);
        expect(screen.getByText('10 items')).toBeInTheDocument();
    });

    it('uses array opener/closer `[` `]` for arrays', () => {
        render(<JsonTree value={[1, 2]} />);
        expect(screen.getAllByText('[').length).toBeGreaterThan(0);
        // 0: 1, 1: 2 — index keys without quotes
        expect(screen.getByText('0:')).toBeInTheDocument();
        expect(screen.getByText('1:')).toBeInTheDocument();
    });

    it('recursively renders nested structures', () => {
        render(
            <JsonTree
                value={{
                    outer: { inner: 'deep' },
                }}
            />,
        );
        expect(screen.getByText('"outer":')).toBeInTheDocument();
        expect(screen.getByText('"inner":')).toBeInTheDocument();
        expect(screen.getByText('"deep"')).toBeInTheDocument();
    });
});
