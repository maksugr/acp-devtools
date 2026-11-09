import type { CapturedMessage } from '@acp-devtools/core';
import { validateMessages, type ValidationResult } from '@acp-devtools/core/acp/validate';

export type { ValidationResult } from '@acp-devtools/core/acp/validate';

/**
 * Run schema validation across a session's messages, returning a
 * `seq → ValidationResult` map. Responses are checked with their request's
 * method, and every frame with the session's negotiated protocol version.
 *
 * Pure / synchronous. Callers should `useMemo` keyed on the `messages`
 * array reference — recomputing on every render of a 500-message timeline
 * costs a few ms but adds up.
 */
export function buildValidationMap(messages: CapturedMessage[]): Map<number, ValidationResult> {
    return validateMessages(messages);
}

export interface ValidationSummary {
    /** Number of frames actually checked (skipped frames excluded). */
    checked: number;
    /** Number of frames that produced at least one ajv error. */
    invalidFrames: number;
    /** Sum of ajv errors across all invalid frames. */
    totalErrors: number;
    /** Unique methods that produced at least one violation. */
    affectedMethods: string[];
    /** Number of frames carrying at least one soon-required advisory. */
    advisoryFrames: number;
    /** Sum of advisories across all frames. */
    totalAdvisories: number;
}

export function summarizeValidation(map: Map<number, ValidationResult>): ValidationSummary {
    let checked = 0;
    let invalidFrames = 0;
    let totalErrors = 0;
    let advisoryFrames = 0;
    let totalAdvisories = 0;
    const affected = new Set<string>();
    for (const [, r] of map) {
        if (r.skipped) continue;
        checked += 1;
        if (!r.valid) {
            invalidFrames += 1;
            totalErrors += r.errors.length;
            if (r.schemaName) {
                // schemaName is e.g. "InitializeRequest" — strip the kind
                // suffix to get the human method back.
                const m = r.schemaName.replace(/(Request|Response|Notification)$/, '');
                affected.add(m);
            }
        }
        if (r.advisories && r.advisories.length > 0) {
            advisoryFrames += 1;
            totalAdvisories += r.advisories.length;
        }
    }
    return {
        checked,
        invalidFrames,
        totalErrors,
        affectedMethods: [...affected].sort(),
        advisoryFrames,
        totalAdvisories,
    };
}
