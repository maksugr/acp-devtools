import { describe, expect, it } from 'vitest';
import type { ValidationResult } from './validation';
import { summarizeValidation } from './validation';

function map(entries: Array<[number, ValidationResult]>): Map<number, ValidationResult> {
    return new Map(entries);
}

describe('summarizeValidation — advisories', () => {
    it('counts advisory frames and total advisories separately from errors', () => {
        const s = summarizeValidation(
            map([
                [
                    1,
                    {
                        valid: true,
                        errors: [],
                        schemaName: 'InitializeResponse',
                        advisories: [{ path: 'agentInfo', kind: 'soon-required', message: 'x' }],
                    },
                ],
                [2, { valid: true, errors: [], schemaName: 'InitializeRequest' }],
                [3, { valid: true, errors: [], skipped: 'unknown-method' }],
            ]),
        );
        expect(s.checked).toBe(2);
        expect(s.invalidFrames).toBe(0);
        expect(s.advisoryFrames).toBe(1);
        expect(s.totalAdvisories).toBe(1);
    });

    it('reports zero advisories for fully conformant sessions', () => {
        const s = summarizeValidation(
            map([[1, { valid: true, errors: [], schemaName: 'InitializeResponse' }]]),
        );
        expect(s.advisoryFrames).toBe(0);
        expect(s.totalAdvisories).toBe(0);
    });
});
