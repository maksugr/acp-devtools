import { useEffect, useMemo, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { CapturedMessage } from '@acp-devtools/core';
import { applyFilters, buildRequestIndex, useMessagesStore } from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';
import { isReplayUrl } from '../api/sessions';
import { groupTimeline, type TimelineEntry } from '../lib/grouping';
import { buildValidationMap, type ValidationResult } from '../lib/validation';
import { MessageRow } from './MessageRow';
import { StreamCluster } from './StreamCluster';
import { PlayheadRail, railStateFor } from './PlayheadRail';

const STICK_BOTTOM_THRESHOLD_PX = 80;

function entrySeqRange(entry: TimelineEntry): [number, number] {
    return entry.type === 'message'
        ? [entry.message.seq, entry.message.seq]
        : [entry.firstSeq, entry.lastSeq];
}

export function Timeline() {
    const messages = useMessagesStore((s) => s.messages);
    const selectedSeq = useMessagesStore((s) => s.selectedSeq);
    const filters = useMessagesStore((s) => s.filters);
    const playhead = useMessagesStore((s) => s.playback.playhead);
    const playing = useMessagesStore((s) => s.playback.playing);
    const select = useMessagesStore((s) => s.select);
    const setPlayhead = useMessagesStore((s) => s.setPlayhead);

    const filtered = useMemo(() => applyFilters(messages, filters), [messages, filters]);
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
    // Virtuoso's last reported visible item range — used both to re-pin a
    // bounced restore scroll and to decide when playback needs to follow.
    const visibleRange = useRef({ startIndex: 0, endIndex: 0 });

    // Auto-scroll-to-bottom is a LIVE-capture affordance only. A live capture
    // is a selected WS URL that is not a saved-session replay (`/replay/N`);
    // imports leave `selectedUrl` null. For replays and imports we leave the
    // view at the top — the user is reading a finished session, not chasing a
    // live tail, so a flying jump to the end is just disorienting.
    const selectedUrl = useDiscoveryStore((s) => s.selectedUrl);
    const isLive = selectedUrl !== null && !isReplayUrl(selectedUrl);

    // Switching to a different live session: pin scroll back at the top so that
    // streaming backlog does not drag the view around. Virtuoso's
    // `followOutput` reads its own `isAtBottom` state, which keeps the live
    // tail quiet until the user explicitly scrolls down (live-tail opt-in).
    const sessionId = useMessagesStore((s) => s.session?.id ?? null);
    const replayDone = useMessagesStore((s) => s.replayDone);
    const prevSessionIdRef = useRef<number | null>(sessionId);
    const landedAtBottomForVisit = useRef(false);
    const restoredForVisit = useRef(false);

    // On session switch: reset the per-visit "already scrolled" flags so the
    // next backlog re-pins (live) or re-restores (recorded) exactly once.
    useEffect(() => {
        if (prevSessionIdRef.current === sessionId) return;
        prevSessionIdRef.current = sessionId;
        landedAtBottomForVisit.current = false;
        restoredForVisit.current = false;
    }, [sessionId]);

    // Pin scroll to the very bottom once per session visit, as soon as the
    // backlog finishes streaming. Instant jump (no smooth animation) so the
    // user never sees a flying scroll. After that, Virtuoso's `followOutput`
    // takes over for live messages; if the user scrolls up, `atBottom` flips
    // to false and we stop following.
    useEffect(() => {
        if (!isLive) return;
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
    }, [isLive, replayDone, sessionId, grouped.length]);

    // Restore scroll position once per visit for a recorded session (replay /
    // import) hydrated from the URL. A finished playhead (the user played to the
    // end before reloading) is reset — there's nothing left to watch. The
    // selected `seq` wins over the playhead as the scroll target; if neither
    // remains, the view just stays at the top. Smooth scroll, not a jump.
    //
    // No cancelling cleanup: under React.StrictMode (dev) the effect runs
    // setup→cleanup→setup, so a `clearTimeout` cleanup would abort the only
    // scheduled scroll while the `restoredForVisit` guard blocks the re-run
    // from rescheduling — leaving the view stranded at the top. The work here
    // is fire-and-forget and idempotent (guarded once, `virtuoso.current?.`
    // is null-safe after unmount), so it is safe to let it run to completion.
    useEffect(() => {
        if (isLive) return;
        if (!replayDone || sessionId === null) return;
        if (restoredForVisit.current) return;
        if (grouped.length === 0) return;
        restoredForVisit.current = true;

        const lastSeq = messages[messages.length - 1]?.seq ?? null;
        let restorePlayhead = playhead;
        if (playhead !== null && lastSeq !== null && playhead >= lastSeq) {
            setPlayhead(null);
            restorePlayhead = null;
        }

        const targetSeq = selectedSeq ?? restorePlayhead;
        if (targetSeq === null) return;
        const idx = grouped.findIndex((entry) => {
            const [min, max] = entrySeqRange(entry);
            return targetSeq >= min && targetSeq <= max;
        });
        if (idx < 0) return;

        const scrollToTarget = (behavior: 'auto' | 'smooth') =>
            virtuoso.current?.scrollToIndex({ index: idx, align: 'center', behavior });

        // Two rAFs land us past Virtuoso's own initial-position pass, then a
        // smooth scroll. The delayed re-pin only fires if a late re-init bounced
        // the view back to the top — otherwise the target is already in view and
        // the snap is a no-op, so a healthy scroll never gets interrupted.
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                scrollToTarget('smooth');
                window.setTimeout(() => {
                    const { startIndex, endIndex } = visibleRange.current;
                    if (idx < startIndex || idx > endIndex) scrollToTarget('auto');
                }, 500);
            }),
        );
    }, [
        isLive,
        replayDone,
        sessionId,
        grouped,
        messages,
        playhead,
        selectedSeq,
        setPlayhead,
    ]);

    // Playback rail: a recorded session (anything that is not a live capture)
    // shows the left-gutter playhead. The rail marks position only — every
    // frame is already on screen.
    const showRail = !isLive && grouped.length > 0;

    const currentEntryIndex = useMemo(() => {
        if (playhead === null) return -1;
        return grouped.findIndex((entry) => {
            const [min, max] = entrySeqRange(entry);
            return playhead >= min && playhead <= max;
        });
    }, [grouped, playhead]);

    // Auto-follow: while playing, keep the playhead in view. If the user wheels
    // away mid-playback we stop following until the next play press, so a manual
    // scroll is never yanked back.
    const followPlayhead = useRef(true);

    useEffect(() => {
        if (playing) followPlayhead.current = true;
    }, [playing]);

    useEffect(() => {
        if (!playing || !followPlayhead.current || currentEntryIndex < 0) return;
        const { startIndex, endIndex } = visibleRange.current;
        const outOfView =
            currentEntryIndex <= startIndex || currentEntryIndex >= endIndex;
        if (outOfView) {
            virtuoso.current?.scrollToIndex({
                index: currentEntryIndex,
                align: 'center',
                behavior: 'auto',
            });
        }
    }, [playing, currentEntryIndex]);

    const renderEntry = (index: number) => {
        const entry = grouped[index];
        if (!entry) return null;
        const row = renderTimelineEntry(entry, {
            selectedSeq,
            pairedSeq,
            onSelect: select,
            responseToRequest,
            reqTimestampBySeq,
            validationBySeq,
        });
        if (!showRail) return row;
        const [min, max] = entrySeqRange(entry);
        return (
            <div className="flex items-stretch">
                <PlayheadRail
                    state={railStateFor(min, max, playhead)}
                    firstRow={index === 0}
                    lastRow={index === grouped.length - 1}
                />
                <div className="min-w-0 flex-1">{row}</div>
            </div>
        );
    };

    return (
        <div
            className="relative flex h-full flex-col"
            onWheel={() => {
                if (playing) followPlayhead.current = false;
            }}
        >
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
                    rangeChanged={(range) => {
                        visibleRange.current = range;
                    }}
                    atBottomThreshold={STICK_BOTTOM_THRESHOLD_PX}
                    {...(isLive
                        ? { initialTopMostItemIndex: Math.max(0, grouped.length - 1) }
                        : {})}
                    followOutput={
                        isLive ? (isAtBottom) => (isAtBottom ? 'auto' : false) : false
                    }
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
