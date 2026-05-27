import type { CapturedMessage } from '@acp-devtools/core';
import {
    validateAcpMessage,
    type ValidationResult,
} from '@acp-devtools/core/acp/validate/browser';
import { buildRequestIndex } from '../store/messagesStore';

export type { ValidationResult } from '@acp-devtools/core/acp/validate/browser';

/**
 * Run schema validation across a session's messages, returning a
 * `seq → ValidationResult` map. For responses/errors the helper looks up
 * the paired request's method via {@link buildRequestIndex} so the
 * `<Method>Response` schema can be applied.
 *
 * Pure / synchronous. Callers should `useMemo` keyed on the `messages`
 * array reference — recomputing on every render of a 500-message timeline
 * costs a few ms but adds up.
 */
export function buildValidationMap(
    messages: CapturedMessage[],
): Map<number, ValidationResult> {
    const responseToRequest = buildRequestIndex(messages);
    const seqToMethod = new Map<number, string>();
    for (const m of messages) {
        if (m.method) seqToMethod.set(m.seq, m.method);
    }
    const out = new Map<number, ValidationResult>();
    for (const m of messages) {
        const reqSeq = responseToRequest.get(m.seq);
        const pairedMethod =
            reqSeq !== undefined ? seqToMethod.get(reqSeq) : undefined;
        const opts: Parameters<typeof validateAcpMessage>[1] = {};
        if (pairedMethod !== undefined) opts.pairedMethod = pairedMethod;
        out.set(m.seq, validateAcpMessage(m, opts));
    }
    return out;
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
}

export function summarizeValidation(map: Map<number, ValidationResult>): ValidationSummary {
    let checked = 0;
    let invalidFrames = 0;
    let totalErrors = 0;
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
    }
    return {
        checked,
        invalidFrames,
        totalErrors,
        affectedMethods: [...affected].sort(),
    };
}
