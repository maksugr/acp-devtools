import { useEffect, useMemo, useRef } from 'react';
import type { CapturedMessage } from '@acp-devtools/core';
import {
    applyFilters,
    buildRequestIndex,
    useMessagesStore,
} from '../store/messagesStore';
import { groupTimeline } from '../lib/grouping';
import { MessageRow } from './MessageRow';
import { StreamCluster } from './StreamCluster';

const STICK_BOTTOM_THRESHOLD = 80;

export function Timeline() {
    const messages = useMessagesStore((s) => s.messages);
    const selectedSeq = useMessagesStore((s) => s.selectedSeq);
    const filters = useMessagesStore((s) => s.filters);
    const select = useMessagesStore((s) => s.select);

    const filtered = useMemo(() => applyFilters(messages, filters), [messages, filters]);
    const grouped = useMemo(() => groupTimeline(filtered), [filtered]);
    const responseToRequest = useMemo(() => buildRequestIndex(messages), [messages]);

    const reqTimestampBySeq = useMemo(() => {
        const m = new Map<number, number>();
        for (const msg of messages) m.set(msg.seq, msg.timestamp);
        return m;
    }, [messages]);

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const stickyBottom = useRef(true);
    const prevMessagesLen = useRef(0);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const grew = messages.length > prevMessagesLen.current;
        prevMessagesLen.current = messages.length;
        if (!grew) return;
        if (!stickyBottom.current) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickyBottom.current = distance < STICK_BOTTOM_THRESHOLD;
    };

    return (
        <div className="relative flex h-full flex-col">
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="flex-1 overflow-y-auto bg-surface-base"
            >
                {grouped.length === 0 ? (
                    <div className="flex h-full items-center justify-center font-mono text-xs text-ink-muted">
                        no messages match current filters
                    </div>
                ) : (
                    grouped.map((entry) => {
                        if (entry.type === 'message') {
                            const m = entry.message;
                            const reqSeq = responseToRequest.get(m.seq);
                            const latency =
                                reqSeq !== undefined
                                    ? m.timestamp - (reqTimestampBySeq.get(reqSeq) ?? m.timestamp)
                                    : undefined;
                            return (
                                <MessageRow
                                    key={m.seq}
                                    message={m}
                                    selected={selectedSeq === m.seq}
                                    {...(latency !== undefined ? { latencyMs: latency } : {})}
                                    onSelect={select}
                                />
                            );
                        }
                        return (
                            <StreamCluster
                                key={`cluster-${entry.firstSeq}-${entry.lastSeq}`}
                                messages={entry.messages}
                                combinedText={entry.combinedText}
                                firstTimestamp={entry.firstTimestamp}
                                lastTimestamp={entry.lastTimestamp}
                                selectedSeq={selectedSeq}
                                onSelect={select}
                            />
                        );
                    })
                )}
            </div>
            <FilteredSummary total={messages.length} shown={filtered.length} />
        </div>
    );
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
