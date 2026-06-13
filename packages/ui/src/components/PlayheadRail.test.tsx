import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PlayheadRail, railStateFor } from './PlayheadRail';

describe('railStateFor', () => {
    it('parks everything as upcoming before playback starts (playhead null)', () => {
        expect(railStateFor(1, 1, null)).toBe('upcoming');
        expect(railStateFor(5, 9, null)).toBe('upcoming');
    });

    it('marks the entry containing the playhead as current', () => {
        expect(railStateFor(3, 3, 3)).toBe('current');
        // clusters span a seq range
        expect(railStateFor(5, 9, 7)).toBe('current');
        expect(railStateFor(5, 9, 5)).toBe('current');
        expect(railStateFor(5, 9, 9)).toBe('current');
    });

    it('marks entries fully behind the playhead as played', () => {
        expect(railStateFor(1, 1, 4)).toBe('played');
        expect(railStateFor(5, 9, 10)).toBe('played');
    });

    it('marks entries ahead of the playhead as upcoming', () => {
        expect(railStateFor(8, 8, 4)).toBe('upcoming');
        expect(railStateFor(5, 9, 4)).toBe('upcoming');
    });
});

describe('PlayheadRail', () => {
    it('renders a knob only on the current row', () => {
        const knob = (html: string) => html.includes('rounded-full');
        const cur = render(<PlayheadRail state="current" />);
        expect(knob(cur.container.innerHTML)).toBe(true);
        const past = render(<PlayheadRail state="played" />);
        expect(knob(past.container.innerHTML)).toBe(false);
        const next = render(<PlayheadRail state="upcoming" />);
        expect(knob(next.container.innerHTML)).toBe(false);
    });

    it('drops the dashed tail below the knob on the last row', () => {
        const mid = render(<PlayheadRail state="current" />);
        expect(mid.container.innerHTML).toContain('border-dashed');
        const last = render(<PlayheadRail state="current" lastRow />);
        // line ends at the dot — nothing leads further down
        expect(last.container.innerHTML).not.toContain('border-dashed');
        expect(last.container.innerHTML).toContain('rounded-full');
    });

    it('drops the solid line above the knob on the first row', () => {
        // a mid-row current knob has the solid lead-in from above
        const mid = render(<PlayheadRail state="current" />);
        expect(mid.container.innerHTML).toContain('border-ink-secondary');
        // the first row starts the line at the dot — nothing leads in from above
        const first = render(<PlayheadRail state="current" firstRow />);
        expect(first.container.innerHTML).not.toContain('border-ink-secondary');
        expect(first.container.innerHTML).toContain('rounded-full');
        expect(first.container.innerHTML).toContain('border-dashed');
    });

    it('uses a dashed line for upcoming rows and a solid line for played rows', () => {
        const played = render(<PlayheadRail state="played" />);
        expect(played.container.innerHTML).not.toContain('border-dashed');
        const upcoming = render(<PlayheadRail state="upcoming" />);
        expect(upcoming.container.innerHTML).toContain('border-dashed');
    });

    it('spans only first-centre→last-centre: crops a half at each end for any state', () => {
        const halves = (html: string) => (html.match(/border-l/g) ?? []).length;
        // a middle row of any state draws both halves
        expect(halves(render(<PlayheadRail state="upcoming" />).container.innerHTML)).toBe(2);
        expect(halves(render(<PlayheadRail state="played" />).container.innerHTML)).toBe(2);
        // the first event has no rail above its centre …
        expect(halves(render(<PlayheadRail state="upcoming" firstRow />).container.innerHTML)).toBe(1);
        // … and the last none below it
        expect(halves(render(<PlayheadRail state="played" lastRow />).container.innerHTML)).toBe(1);
        // a single-entry session keeps just the knob, no line
        const solo = render(<PlayheadRail state="current" firstRow lastRow />);
        expect(halves(solo.container.innerHTML)).toBe(0);
        expect(solo.container.innerHTML).toContain('rounded-full');
    });
});
