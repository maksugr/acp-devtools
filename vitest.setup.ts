// Loaded by vitest for every test file. Adds jest-dom matchers
// (`.toBeInTheDocument()`, `.toHaveClass(…)`, …) and runs React Testing
// Library's `cleanup()` between tests so DOM from one test doesn't leak
// into the next (rerender / multiple-render tests in particular).
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
    cleanup();
});
