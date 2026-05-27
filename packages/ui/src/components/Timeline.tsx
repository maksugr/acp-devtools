import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { CapturedMessage } from '@acp-devtools/core';
import { applyFilters, buildRequestIndex, useMessagesStore } from '../store/messagesStore';
import { groupTimeline, type TimelineEntry } from '../lib/grouping';
import { buildValidationMap, type ValidationResult } from '../lib/validation';
import { MessageRow } from './MessageRow';
import { StreamCluster } from './StreamCluster';

const STICK_BOTTOM_THRESHOLD_PX = 80;

export function Timeline() {
    const messages = useMessagesStore((s) => s.messages);
    const selectedSeq = useMessagesStore((s) => s.selectedSeq);
    const filters = useMessagesStore((s) => s.filters);
    const playbackCap = useMessagesStore((s) => s.playback.cap);
    const select = useMessagesStore((s) => s.select);

    const filtered = useMemo(
        () => applyFilters(messages, filters, playbackCap),
        [messages, filters, playbackCap],
    );
    const grouped = useMemo(() => groupTimeline(filtered), [filtered]);
    const responseToRequest = useMemo(() => buildRequestIndex(messages), [messages]);
    const validationBySeq = useMemo(() => buildValidationMap(messages), [messages]);

    const reqTimestampBySeq = useMemo(() => {
        const m = new Map<number, number>();
        for (const msg of messages) m.set(msg.seq, msg.timestamp);
        return m;
    }, [messages]);

    const pairedSeq = useMemo<number | null>(() => {
        if (selectedSeq === null) return null;
        const req = responseToRequest.get(selectedSeq);
        if (req !== undefined) return req;
        for (const [resp, r] of responseToRequest) {
            if (r === selectedSeq) return resp;
        }
        return null;
    }, [selectedSeq, responseToRequest]);

    const virtuoso = useRef<VirtuosoHandle | null>(null);
    const [atBottom, setAtBottom] = useState(false);

    // Switching to a different session: pin scroll back at the top so that
    // streaming backlog does not drag the view around. Virtuoso will then
    // report `atBottom = false`, which keeps `followOutput` quiet until the
    // user explicitly scrolls down (live-tail opt-in).
    const sessionId = useMessagesStore((s) => s.session?.id ?? null);
    const replayDone = useMessagesStore((s) => s.replayDone);
    const prevSessionIdRef = useRef<number | null>(sessionId);
    const landedAtBottomForVisit = useRef(false);

    // On session switch: reset the "did we land at the end yet?" flag so the
    // next time the backlog finishes we re-pin to the bottom.
    useEffect(() => {
        if (prevSessionIdRef.current === sessionId) return;
        prevSessionIdRef.current = sessionId;
        landedAtBottomForVisit.current = false;
    }, [sessionId]);

    // Pin scroll to the very bottom once per session visit, as soon as the
    // backlog finishes streaming. Instant jump (no smooth animation) so the
    // user never sees a flying scroll. After that, Virtuoso's `followOutput`
    // takes over for live messages; if the user scrolls up, `atBottom` flips
    // to false and we stop following.
    useEffect(() => {
        if (!replayDone || sessionId === null) return;
        if (landedAtBottomForVisit.current) return;
        if (grouped.length === 0) return;
        landedAtBottomForVisit.current = true;
        const lastIndex = grouped.length - 1;
        // Defer one tick so Virtuoso has finished measuring the items it just
        // ingested, then smooth-scroll to the latest message. Browser-native
        // smooth scroll = animated ease, no visible jerks.
        const handle = window.setTimeout(() => {
            virtuoso.current?.scrollToIndex({
                index: lastIndex,
                align: 'end',
                behavior: 'smooth',
            });
        }, 50);
        return () => window.clearTimeout(handle);
    }, [replayDone, sessionId, grouped.length]);

    const renderEntry = (index: number) => {
        const entry = grouped[index];
        if (!entry) return null;
        return renderTimelineEntry(entry, {
            selectedSeq,
            pairedSeq,
            onSelect: select,
            responseToRequest,
            reqTimestampBySeq,
            validationBySeq,
        });
    };

    return (
        <div className="relative flex h-full flex-col">
            {grouped.length === 0 ? (
                <div className="flex h-full items-center justify-center bg-surface-base font-mono text-xs text-ink-muted">
                    no messages match current filters
                </div>
            ) : (
                <Virtuoso
                    ref={virtuoso}
                    className="flex-1 bg-surface-base"
                    totalCount={grouped.length}
                    itemContent={renderEntry}
                    atBottomStateChange={setAtBottom}
                    atBottomThreshold={STICK_BOTTOM_THRESHOLD_PX}
                    initialTopMostItemIndex={Math.max(0, grouped.length - 1)}
                    followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
                    computeItemKey={(index) => entryKey(grouped[index]!)}
                />
            )}
            <FilteredSummary total={messages.length} shown={filtered.length} />
        </div>
    );
}

interface RenderCtx {
    selectedSeq: number | null;
    pairedSeq: number | null;
    onSelect: (seq: number) => void;
    responseToRequest: Map<number, number>;
    reqTimestampBySeq: Map<number, number>;
    validationBySeq: Map<number, ValidationResult>;
}

function renderTimelineEntry(entry: TimelineEntry, ctx: RenderCtx): React.ReactElement {
    if (entry.type === 'message') {
        const m = entry.message;
        const reqSeq = ctx.responseToRequest.get(m.seq);
        const latency =
            reqSeq !== undefined
                ? m.timestamp - (ctx.reqTimestampBySeq.get(reqSeq) ?? m.timestamp)
                : undefined;
        const validation = ctx.validationBySeq.get(m.seq);
        return (
            <MessageRow
                message={m}
                selected={ctx.selectedSeq === m.seq}
                paired={ctx.pairedSeq === m.seq}
                {...(latency !== undefined ? { latencyMs: latency } : {})}
                {...(validation !== undefined ? { validation } : {})}
                onSelect={ctx.onSelect}
            />
        );
    }
    return (
        <StreamCluster
            messages={entry.messages}
            combinedText={entry.combinedText}
            firstTimestamp={entry.firstTimestamp}
            lastTimestamp={entry.lastTimestamp}
            selectedSeq={ctx.selectedSeq}
            onSelect={ctx.onSelect}
        />
    );
}

function entryKey(entry: TimelineEntry): string {
    if (entry.type === 'message') return `m-${entry.message.seq}`;
    return `c-${entry.firstSeq}-${entry.lastSeq}`;
}

function FilteredSummary({ total, shown }: { total: number; shown: number }) {
    if (total === 0 || shown === total) return null;
    return (
        <div className="border-t border-line bg-surface-elev/60 px-4 py-1 text-right font-mono text-[10px] uppercase tracking-widest text-ink-muted">
            showing {shown} of {total}
        </div>
    );
}

export type { CapturedMessage };
