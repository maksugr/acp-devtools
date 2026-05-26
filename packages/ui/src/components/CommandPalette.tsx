import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import {
    ALL_DIRECTIONS,
    ALL_KINDS,
    useMessagesStore,
    type Filters,
} from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';
import { captureLabel, shortAgentName } from '../lib/captureLabel';
import { replayUrlFor } from '../api/sessions';

interface Command {
    id: string;
    label: string;
    hint?: string;
    section: string;
    run: () => void;
}

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIndex(0);
        const t = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(t);
    }, [open]);

    const commands = useMemo<Command[]>(() => buildCommands(onClose), [onClose, open]);
    const filtered = useMemo<Command[]>(() => filterCommands(commands, query), [commands, query]);

    useEffect(() => {
        if (activeIndex >= filtered.length) setActiveIndex(0);
    }, [filtered.length, activeIndex]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) =>
                    filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
                );
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = filtered[activeIndex];
                if (cmd) {
                    cmd.run();
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, filtered, activeIndex, onClose]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[8vh] backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-[min(620px,92vw)] overflow-hidden rounded-md border border-line-strong bg-surface-elev shadow-2xl">
                <div className="border-b border-line bg-surface-base/60">
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        placeholder="type a command…  esc closes  ↑↓ navigate  ↵ run"
                        className="w-full bg-transparent px-4 py-3 font-mono text-[13px] text-ink-primary placeholder-ink-muted outline-none"
                    />
                </div>
                <ul className="max-h-[60vh] overflow-y-auto py-1">
                    {filtered.length === 0 && (
                        <li className="px-4 py-3 text-center font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                            no match
                        </li>
                    )}
                    {filtered.map((cmd, i) => {
                        const active = i === activeIndex;
                        const prev = filtered[i - 1];
                        const showSection = !prev || prev.section !== cmd.section;
                        return (
                            <li key={cmd.id}>
                                {showSection && (
                                    <div className="px-4 pt-2 pb-1 font-mono text-[9px] uppercase tracking-widest text-ink-muted">
                                        {cmd.section}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        cmd.run();
                                        onClose();
                                    }}
                                    onMouseEnter={() => setActiveIndex(i)}
                                    className={cn(
                                        'flex w-full items-center justify-between px-4 py-1.5 text-left font-mono text-[12px] transition-colors',
                                        active
                                            ? 'bg-accent-out/10 text-ink-primary'
                                            : 'text-ink-secondary hover:bg-surface-rowHover hover:text-ink-primary',
                                    )}
                                >
                                    <span className="truncate">{cmd.label}</span>
                                    {cmd.hint && (
                                        <span className="ml-3 shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-ink-muted">
                                            {cmd.hint}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}

function buildCommands(onClose: () => void): Command[] {
    const msgState = useMessagesStore.getState();
    const discState = useDiscoveryStore.getState();
    const cmds: Command[] = [];

    cmds.push({
        id: 'view.clear',
        label: 'Clear messages from view',
        section: 'view',
        run: () => msgState.clear(),
    });
    cmds.push({
        id: 'view.deselect',
        label: 'Deselect message',
        hint: 'esc',
        section: 'view',
        run: () => msgState.select(null),
    });
    cmds.push({
        id: 'view.toggle-boilerplate',
        label: msgState.filters.hideBoilerplate
            ? 'Show set_mode / set_model messages'
            : 'Hide set_mode / set_model messages',
        section: 'filter',
        run: () => msgState.setHideBoilerplate(!msgState.filters.hideBoilerplate),
    });
    cmds.push({
        id: 'view.toggle-streams',
        label: msgState.filters.showStreams
            ? 'Hide streaming chunks'
            : 'Show streaming chunks',
        section: 'filter',
        run: () => msgState.toggleStreams(),
    });
    cmds.push({
        id: 'filter.reset',
        label: 'Reset all filters',
        section: 'filter',
        run: () => {
            const reset: Pick<Filters, 'directions' | 'kinds' | 'hideBoilerplate' | 'showStreams' | 'search'> = {
                directions: new Set(ALL_DIRECTIONS),
                kinds: new Set(ALL_KINDS),
                hideBoilerplate: false,
                showStreams: true,
                search: '',
            };
            useMessagesStore.setState({ filters: reset });
        },
    });

    for (const dir of ALL_DIRECTIONS) {
        const on = msgState.filters.directions.has(dir);
        cmds.push({
            id: `filter.dir.${dir}`,
            label: `${on ? 'Hide' : 'Show'} ${dir === 'editor-to-agent' ? 'editor → agent' : 'agent → editor'} messages`,
            section: 'filter',
            run: () => msgState.toggleDirection(dir),
        });
    }
    for (const kind of ALL_KINDS) {
        const on = msgState.filters.kinds.has(kind);
        cmds.push({
            id: `filter.kind.${kind}`,
            label: `${on ? 'Hide' : 'Show'} ${kind} kind`,
            section: 'filter',
            run: () => msgState.toggleKind(kind),
        });
    }

    if (msgState.selectedSeq !== null) {
        const m = msgState.messages.find((x) => x.seq === msgState.selectedSeq);
        if (m) {
            cmds.push({
                id: 'copy.raw',
                label: `Copy selected message raw line (seq ${m.seq})`,
                section: 'copy',
                run: () => {
                    void navigator.clipboard.writeText(m.raw);
                },
            });
            if (m.payload) {
                cmds.push({
                    id: 'copy.payload',
                    label: `Copy selected payload as JSON (seq ${m.seq})`,
                    section: 'copy',
                    run: () => {
                        void navigator.clipboard.writeText(JSON.stringify(m.payload, null, 2));
                    },
                });
            }
        }
    }

    for (const c of discState.captures) {
        cmds.push({
            id: `switch.live.${c.url}`,
            label: `Switch to live: ${captureLabel(c)}`,
            section: 'switch',
            run: () => discState.setSelected(c.url),
        });
    }
    for (const s of discState.savedSessions.slice(0, 25)) {
        const agent = shortAgentName(s.agent_command ?? '');
        const label =
            s.name ?? (s.client_name ? `${s.client_name} · ${agent}` : agent);
        cmds.push({
            id: `switch.saved.${s.id}`,
            label: `Open saved #${s.id} · ${label} (${s.message_count} msg)`,
            section: 'switch',
            run: () => discState.setSelected(replayUrlFor(s.id)),
        });
    }

    void onClose;
    return cmds;
}

function filterCommands(cmds: Command[], query: string): Command[] {
    const q = query.trim().toLowerCase();
    if (q === '') return cmds;
    const tokens = q.split(/\s+/);
    return cmds.filter((c) => {
        const hay = c.label.toLowerCase();
        return tokens.every((t) => hay.includes(t));
    });
}
