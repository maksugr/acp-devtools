import { useEffect, useMemo, useRef, useState } from 'react';
import { connect, disconnect } from './api/websocket';
import { startDiscoveryPolling } from './api/discovery';
import {
    buildRequestIndex,
    selectMessage,
    useMessagesStore,
} from './store/messagesStore';
import { useDiscoveryStore } from './store/discoveryStore';
import { captureLabel } from './lib/captureLabel';
import { DetailPanel } from './components/DetailPanel';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SplitPane } from './components/SplitPane';
import { StatsBar } from './components/StatsBar';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';

const URL_OVERRIDE = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ws');
})();

export function App() {
    const captures = useDiscoveryStore((s) => s.captures);
    const selectedUrl = useDiscoveryStore((s) => s.selectedUrl);
    const setSelected = useDiscoveryStore((s) => s.setSelected);

    const wsUrl = URL_OVERRIDE ?? selectedUrl;

    // Start polling discovery whenever there is no manual ?ws override.
    useEffect(() => {
        if (URL_OVERRIDE) return;
        const stop = startDiscoveryPolling();
        return stop;
    }, []);

    const [toast, setToast] = useState<string | null>(null);
    const prevUrls = useRef<Set<string>>(new Set());

    // Auto-pick the newest capture. Three cases:
    //  1. no selection yet → pick newest silently
    //  2. selection vanished (proxy died) → fall back to newest silently
    //  3. new capture appeared (e.g. another IDE chat) → switch + toast
    useEffect(() => {
        if (URL_OVERRIDE) return;
        const currentUrlSet = new Set(captures.map((c) => c.url));
        const newest = captures[0] ?? null;
        const initial = selectedUrl === null;
        const stillThere = selectedUrl !== null && currentUrlSet.has(selectedUrl);
        const newCaptureAppeared =
            newest !== null && !prevUrls.current.has(newest.url) && prevUrls.current.size > 0;

        if (captures.length === 0) {
            if (selectedUrl !== null) setSelected(null);
        } else if (initial || !stillThere) {
            setSelected(newest!.url);
        } else if (newCaptureAppeared && newest!.url !== selectedUrl) {
            setSelected(newest!.url);
            setToast(`switched → ${captureLabel(newest!)}`);
        }
        prevUrls.current = currentUrlSet;
    }, [captures, selectedUrl, setSelected]);

    // Auto-dismiss the toast after 3 s of actual visible time. If the window
    // is hidden we pause the countdown so the user gets the full 3 s the next
    // time they look at the browser.
    useEffect(() => {
        if (!toast) return;
        let remaining = 3000;
        let lastResume = Date.now();
        let timer: ReturnType<typeof setTimeout> | null = null;

        const resume = () => {
            if (timer !== null) return;
            if (document.visibilityState !== 'visible') return;
            lastResume = Date.now();
            timer = setTimeout(() => setToast(null), remaining);
        };
        const pause = () => {
            if (timer === null) return;
            clearTimeout(timer);
            timer = null;
            remaining = Math.max(0, remaining - (Date.now() - lastResume));
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') resume();
            else pause();
        };

        document.addEventListener('visibilitychange', onVisibility);
        resume();
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            if (timer) clearTimeout(timer);
        };
    }, [toast]);

    // Connect / reconnect whenever the chosen URL changes.
    useEffect(() => {
        if (!wsUrl) {
            disconnect();
            return;
        }
        connect(wsUrl);
    }, [wsUrl]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                useMessagesStore.getState().select(null);
                return;
            }
            if (e.key === 'j' || e.key === 'J') {
                stepSelection(1);
                return;
            }
            if (e.key === 'k' || e.key === 'K') {
                stepSelection(-1);
                return;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const messages = useMessagesStore((s) => s.messages);
    const session = useMessagesStore((s) => s.session);
    const selectedSeq = useMessagesStore((s) => s.selectedSeq);
    const status = useMessagesStore((s) => s.connection);
    const lastError = useMessagesStore((s) => s.lastError);

    const selectedMessage = useMemo(
        () => selectMessage(messages, selectedSeq),
        [messages, selectedSeq],
    );

    const pairing = useMemo(() => {
        const responseToRequest = buildRequestIndex(messages);
        const requestToResponse = new Map<number, number>();
        for (const [resp, req] of responseToRequest.entries()) requestToResponse.set(req, resp);
        return { responseToRequest, requestToResponse };
    }, [messages]);

    let latency: number | undefined;
    let paired: typeof selectedMessage = null;
    if (selectedMessage) {
        if (selectedMessage.kind === 'response' || selectedMessage.kind === 'error') {
            const reqSeq = pairing.responseToRequest.get(selectedMessage.seq);
            if (reqSeq !== undefined) {
                paired = messages.find((m) => m.seq === reqSeq) ?? null;
                if (paired) latency = selectedMessage.timestamp - paired.timestamp;
            }
        } else if (selectedMessage.kind === 'request') {
            const respSeq = pairing.requestToResponse.get(selectedMessage.seq);
            if (respSeq !== undefined) {
                paired = messages.find((m) => m.seq === respSeq) ?? null;
                if (paired) latency = paired.timestamp - selectedMessage.timestamp;
            }
        }
    }

    const showEmpty = messages.length === 0 && !session;
    const displayUrl = wsUrl ?? 'no capture selected';

    return (
        <div className="flex h-full flex-col bg-surface-base text-ink-primary">
            <Toast message={toast} tone="success" />
            <TopBar
                wsUrl={displayUrl}
                overrideUrl={URL_OVERRIDE}
                onPickCapture={
                    URL_OVERRIDE
                        ? null
                        : (url) => {
                              setSelected(url);
                              prevUrls.current.add(url);
                          }
                }
                activeUrl={wsUrl}
            />
            <FilterBar />
            <main className="flex-1 overflow-hidden">
                {showEmpty ? (
                    <EmptyState
                        status={status}
                        lastError={lastError}
                        url={displayUrl}
                        captureCount={captures.length}
                    />
                ) : (
                    <SplitPane
                        storageKey="acp.split.leftPx"
                        initialLeftFraction={0.62}
                        minLeft={420}
                        minRight={360}
                        left={<Timeline />}
                        right={
                            <DetailPanel
                                message={selectedMessage}
                                {...(latency !== undefined ? { latencyMs: latency } : {})}
                                {...(paired ? { pairedRequest: paired } : {})}
                            />
                        }
                    />
                )}
            </main>
            <StatsBar />
        </div>
    );
}

function stepSelection(dir: 1 | -1): void {
    const state = useMessagesStore.getState();
    const { messages, selectedSeq } = state;
    if (messages.length === 0) return;
    if (selectedSeq === null) {
        const target = dir === 1 ? messages[0] : messages[messages.length - 1];
        if (target) state.select(target.seq);
        return;
    }
    const idx = messages.findIndex((m) => m.seq === selectedSeq);
    if (idx === -1) {
        const target = messages[0];
        if (target) state.select(target.seq);
        return;
    }
    const next = messages[idx + dir];
    if (next) state.select(next.seq);
}
