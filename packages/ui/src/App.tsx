import { useEffect, useMemo, useRef, useState } from 'react';
import { connect, disconnect } from './api/websocket';
import { startDiscoveryPolling } from './api/discovery';
import { bindSystemThemeListener } from './store/themeStore';
import {
    buildRequestIndex,
    selectMessage,
    useMessagesStore,
} from './store/messagesStore';
import { useDiscoveryStore } from './store/discoveryStore';
import { captureLabel } from './lib/captureLabel';
import { parseUrlState, writeUrlState } from './lib/urlState';
import { CommandPalette } from './components/CommandPalette';
import { ConnectingState } from './components/ConnectingState';
import { DetailPanel } from './components/DetailPanel';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { ReplayControls } from './components/ReplayControls';
import { SplitPane } from './components/SplitPane';
import { StatsBar } from './components/StatsBar';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';

export function App() {
    const captures = useDiscoveryStore((s) => s.captures);
    const selectedUrl = useDiscoveryStore((s) => s.selectedUrl);
    const setSelected = useDiscoveryStore((s) => s.setSelected);

    const wsUrl = selectedUrl;
    const isReplaySelected =
        selectedUrl !== null && /\/replay\/\d+$/.test(selectedUrl);

    useEffect(() => {
        const stop = startDiscoveryPolling();
        return stop;
    }, []);

    // Re-apply theme when the OS preference changes (only effective in `system` mode).
    useEffect(() => bindSystemThemeListener(), []);

    const [toast, setToast] = useState<string | null>(null);
    const prevUrls = useRef<Set<string>>(new Set());

    // Hydrate everything (filters, selected seq, detail tab, playback cap,
    // capture URL) from the query string on first render. URL wins over
    // localStorage so a shared link reproduces the exact state.
    useEffect(() => {
        const parsed = parseUrlState(window.location.search);
        const state = useMessagesStore.getState();
        const patch: Partial<typeof state> = {};
        if (Object.keys(parsed.filters).length > 0) {
            patch.filters = { ...state.filters, ...parsed.filters };
        }
        if (parsed.selectedSeq !== null) patch.selectedSeq = parsed.selectedSeq;
        if (parsed.detailTab !== null) patch.detailTab = parsed.detailTab;
        if (parsed.playbackCap !== null) {
            patch.playback = { ...state.playback, cap: parsed.playbackCap };
        }
        if (Object.keys(patch).length > 0) useMessagesStore.setState(patch);
        if (parsed.captureUrl) {
            useDiscoveryStore.getState().setSelected(parsed.captureUrl);
        }
    }, []);

    // Mirror the full UI state into the URL on every change.
    useEffect(() => {
        const flush = () => {
            const m = useMessagesStore.getState();
            const d = useDiscoveryStore.getState();
            writeUrlState({
                filters: m.filters,
                selectedSeq: m.selectedSeq,
                detailTab: m.detailTab,
                playbackCap: m.playback.cap,
                captureUrl: d.selectedUrl,
            });
        };
        const unsubM = useMessagesStore.subscribe(flush);
        const unsubD = useDiscoveryStore.subscribe(flush);
        flush();
        return () => {
            unsubM();
            unsubD();
        };
    }, []);

    // Auto-pick the newest *live* capture. Saved-session URLs (/replay/N) are
    // deliberate user choices — never override them.
    useEffect(() => {
        const currentUrlSet = new Set(captures.map((c) => c.url));
        prevUrls.current = (() => {
            const prev = prevUrls.current;
            // refresh prev tracking even when we exit early below
            return prev;
        })();

        if (isReplaySelected) {
            prevUrls.current = currentUrlSet;
            return;
        }

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
    }, [captures, selectedUrl, setSelected, isReplaySelected]);

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

    const [paletteOpen, setPaletteOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setPaletteOpen((v) => !v);
                return;
            }
            if (paletteOpen) return; // palette handles its own keys
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
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
    }, [paletteOpen]);

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

    const hasNoData = messages.length === 0 && !session;
    const displayUrl = wsUrl ?? 'no capture selected';
    // "Tutorial" empty state shows only when we have nowhere to connect and
    // no captures to attach to — i.e. real first-launch onboarding. Once a
    // capture URL is selected (e.g. after hydration from `?ws=`), we show a
    // calm `ConnectingState` instead of the big CLI card to avoid flashing.
    const showTutorial = hasNoData && wsUrl === null && captures.length === 0;
    const showConnecting = hasNoData && !showTutorial;

    return (
        <div className="flex h-full flex-col bg-surface-base text-ink-primary">
            <Toast message={toast} tone="success" />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            <TopBar
                wsUrl={displayUrl}
                overrideUrl={null}
                isReplay={isReplaySelected}
                onPickCapture={(url) => {
                    setSelected(url);
                    prevUrls.current.add(url);
                }}
                activeUrl={wsUrl}
            />
            <FilterBar />
            <main className="flex-1 overflow-hidden">
                {showTutorial ? (
                    <EmptyState
                        status={status}
                        lastError={lastError}
                        url={displayUrl}
                        captureCount={captures.length}
                    />
                ) : showConnecting ? (
                    <ConnectingState
                        status={status}
                        url={displayUrl}
                        lastError={lastError}
                    />
                ) : (
                    <SplitPane
                        storageKey="acp.split.leftPx"
                        initialLeftFraction={0.62}
                        minLeft={420}
                        minRight={360}
                        left={
                            <div className="flex h-full flex-col">
                                <div className="min-h-0 flex-1">
                                    <Timeline />
                                </div>
                                {isReplaySelected && <ReplayControls />}
                            </div>
                        }
                        right={
                            <DetailPanel
                                message={selectedMessage}
                                {...(latency !== undefined ? { latencyMs: latency } : {})}
                                {...(paired ? { pairedRequest: paired } : {})}
                                onJumpToPaired={(seq) =>
                                    useMessagesStore.getState().select(seq)
                                }
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
