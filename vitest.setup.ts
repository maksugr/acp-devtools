// Loaded by vitest for every test file. Adds jest-dom matchers
// (`.toBeInTheDocument()`, `.toHaveClass(…)`, …) and runs React Testing
// Library's `cleanup()` between tests so DOM from one test doesn't leak
// into the next (rerender / multiple-render tests in particular).
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement HTMLCanvasElement.getContext — without this
// stub, every test that mounts <TimelineCanvas> floods stderr with a
// "Not implemented" warning. The canvas itself isn't visually asserted
// (we only test surrounding DOM), so a no-op 2D context is enough.
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
}

afterEach(() => {
    cleanup();
});
