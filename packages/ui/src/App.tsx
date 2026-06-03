import { useEffect, useMemo, useRef, useState } from 'react';
import { connect, disconnect } from './api/websocket';
import { startDiscoveryPolling } from './api/discovery';
import { bindSystemThemeListener } from './store/themeStore';
import {
    buildRequestIndex,
    selectMessage,
    useMessagesStore,
} from './store/messagesStore';
import { buildValidationMap } from './lib/validation';
import { useDiscoveryStore } from './store/discoveryStore';
import { captureLabel, sessionHeader } from './lib/captureLabel';
import { isPlaygroundMode } from './lib/playgroundMode';
import { parseUrlState, writeUrlState } from './lib/urlState';
import { CommandPalette } from './components/CommandPalette';
import { ConnectingState } from './components/ConnectingState';
import { DetailPanel } from './components/DetailPanel';
import { DiffPanel } from './components/DiffPanel';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { PerformancePanel } from './components/PerformancePanel';
import { PlaygroundEntry } from './components/PlaygroundEntry';
import { ReplayControls } from './components/ReplayControls';
import { SessionInfoPanel } from './components/SessionInfoPanel';
import { SplitPane } from './components/SplitPane';
import { StatsBar } from './components/StatsBar';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';

const PLAYGROUND = isPlaygroundMode();
const INITIAL_PLAYGROUND_URL = PLAYGROUND
    ? new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('url')
    : null;

export function App() {
    const captures = useDiscoveryStore((s) => s.captures);
    const selectedUrl = useDiscoveryStore((s) => s.selectedUrl);
    const setSelected = useDiscoveryStore((s) => s.setSelected);
    const sessionImportedAt = useMessagesStore((s) => s.session?.importedAt ?? null);

    const wsUrl = selectedUrl;
    const isReplaySelected =
        selectedUrl !== null && /\/replay\/\d+$/.test(selectedUrl);
    const isImported = sessionImportedAt !== null;

    useEffect(() => {
        if (PLAYGROUND) return;
        const stop = startDiscoveryPolling();
        return stop;
    }, []);

    // Re-apply theme when the OS preference changes (only effective in `system` mode).
    useEffect(() => bindSystemThemeListener(), []);

    const [toast, setToast] = useState<{ message: string; tone: 'info' | 'success' | 'warn' } | null>(null);
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

    // Drawer state is NOT persisted in the URL — page reload always starts
    // with both drawers closed. The browser Back button still undoes
    // opening a drawer thanks to a `history.state` marker (no URL param)
    // pushed when the drawer opens; popstate inspects the marker.
    const [infoOpen, setInfoOpenInternal] = useState(false);
    const [perfOpen, setPerfOpenInternal] = useState(false);
    const [diffOpen, setDiffOpenInternal] = useState(false);

    // Mirror the full UI state into the URL on every change — same
    // `replaceState` behaviour the app had before. Drawer-open state is
    // tracked separately via `history.state` (see openInfo/openPerf below).
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

    // Drawer open/close — opening pushes a history entry tagged with the
    // drawer name; closing (via close button OR via selecting a timeline
    // event) calls `history.back()` so the popstate handler runs and the
    // browser back-stack stays consistent with the visible state.
    const openInfo = () => {
        if (infoOpen) return;
        window.history.pushState({ drawer: 'info' }, '', window.location.href);
        setInfoOpenInternal(true);
    };
    const openPerf = () => {
        if (perfOpen) return;
        window.history.pushState({ drawer: 'perf' }, '', window.location.href);
        setPerfOpenInternal(true);
    };
    const openDiff = () => {
        if (diffOpen) return;
        window.history.pushState({ drawer: 'diff' }, '', window.location.href);
        setDiffOpenInternal(true);
    };
    const closeInfo = () => {
        if (!infoOpen) return;
        window.history.back();
    };
    const closePerf = () => {
        if (!perfOpen) return;
        window.history.back();
    };
    const closeDiff = () => {
        if (!diffOpen) return;
        window.history.back();
    };
    // Click a timeline event inside the perf drawer → navigate forward to
    // a new history entry with that selection, drawer closed. This is NOT
    // closePerf() (which would go back); we want forward navigation so the
    // user can press Back to return to the perf-open view they came from.
    const navigateFromDrawer = (seq: number) => {
        window.history.pushState({ drawer: null }, '', window.location.href);
        useMessagesStore.getState().select(seq);
        setInfoOpenInternal(false);
        setPerfOpenInternal(false);
        setDiffOpenInternal(false);
    };

    // Browser Back/Forward — sync the drawer flags to whatever the new
    // history entry's state object describes. Routine state (selection,
    // filters) is already in the URL and reapplied via the parsed query.
    useEffect(() => {
        const onPop = (e: PopStateEvent) => {
            const state = e.state as { drawer?: 'info' | 'perf' | 'diff' } | null;
            setInfoOpenInternal(state?.drawer === 'info');
            setPerfOpenInternal(state?.drawer === 'perf');
            setDiffOpenInternal(state?.drawer === 'diff');
            const parsed = parseUrlState(window.location.search);
            const ms = useMessagesStore.getState();
            const ds = useDiscoveryStore.getState();
            const patch: Partial<ReturnType<typeof useMessagesStore.getState>> = {};
            if (Object.keys(parsed.filters).length > 0) {
                patch.filters = { ...ms.filters, ...parsed.filters };
            }
            patch.selectedSeq = parsed.selectedSeq;
            patch.detailTab = parsed.detailTab ?? 'tree';
            patch.playback = { ...ms.playback, cap: parsed.playbackCap };
            useMessagesStore.setState(patch);
            if (parsed.captureUrl !== ds.selectedUrl && parsed.captureUrl) {
                ds.setSelected(parsed.captureUrl);
            }
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    // Auto-pick the newest *live* capture. Saved-session URLs (/replay/N) are
    // deliberate user choices — never override them. Imports become regular
    // saved sessions via `/replay/<id>` and are covered by the same guard.
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
            setToast({ message: `switched → ${captureLabel(newest!)}`, tone: 'success' });
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
        if (PLAYGROUND) {
            disconnect();
            return;
        }
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

    // Browser tab title carries the selected capture label so several
    // inspector tabs are easy to tell apart at a glance. Convention is
    // page-name-first (truncates better in narrow tabs) — app name suffix.
    useEffect(() => {
        const base = 'ACP Devtools';
        if (!session) {
            document.title = base;
            return;
        }
        const { primary, secondary } = sessionHeader(session);
        const head = secondary ? `${primary} · ${secondary}` : primary;
        document.title = `${head} — ${base}`;
    }, [session]);

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

    const validationBySeq = useMemo(() => buildValidationMap(messages), [messages]);

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
    // In playground mode there is no backend → the file-drop entry replaces
    // both the tutorial and the connecting state.
    const showPlayground = PLAYGROUND && hasNoData;
    const showTutorial =
        !PLAYGROUND && hasNoData && wsUrl === null && captures.length === 0;
    const showConnecting = !PLAYGROUND && hasNoData && !showTutorial;

    return (
        <div className="flex h-full flex-col bg-surface-base text-ink-primary">
            <Toast message={toast?.message ?? null} tone={toast?.tone ?? 'info'} />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            <SessionInfoPanel open={infoOpen} onClose={closeInfo} />
            <PerformancePanel
                open={perfOpen}
                onClose={closePerf}
                onNavigateToSeq={navigateFromDrawer}
            />
            <DiffPanel open={diffOpen} onClose={closeDiff} />
            <TopBar
                wsUrl={displayUrl}
                overrideUrl={null}
                isReplay={isReplaySelected}
                isImported={isImported}
                onPickCapture={(url) => {
                    setSelected(url);
                    prevUrls.current.add(url);
                }}
                onImportResult={(message, tone) => setToast({ message, tone })}
                activeUrl={wsUrl}
                onOpenInfo={openInfo}
                onOpenPerf={openPerf}
                onOpenDiff={openDiff}
            />
            <FilterBar />
            <main className="flex-1 overflow-hidden">
                {showPlayground ? (
                    <PlaygroundEntry initialUrl={INITIAL_PLAYGROUND_URL} />
                ) : showTutorial ? (
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
                                {(isReplaySelected || isImported) && <ReplayControls />}
                            </div>
                        }
                        right={
                            <DetailPanel
                                message={selectedMessage}
                                {...(latency !== undefined ? { latencyMs: latency } : {})}
                                {...(paired ? { pairedRequest: paired } : {})}
                                {...(selectedMessage
                                    ? (() => {
                                          const v = validationBySeq.get(selectedMessage.seq);
                                          return v ? { validation: v } : {};
                                      })()
                                    : {})}
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
