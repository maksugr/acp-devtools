import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { refreshSavedSessions } from '../api/discovery';
import { downloadSessionExport } from '../lib/downloadExport';
import { importSession, replayUrlFor } from '../api/sessions';
import { useDiscoveryStore } from '../store/discoveryStore';
import { useMessagesStore } from '../store/messagesStore';

export type SessionActionToastTone = 'info' | 'success' | 'warn';

interface SessionActionsMenuProps {
    /**
     * Surface import outcomes (success or parse error) to the App-level Toast.
     * Optional so tests can render the menu without wiring it.
     */
    onImportResult?: (message: string, tone: SessionActionToastTone) => void;
}

/**
 * Single icon-button trigger that opens a small vertical popover with the
 * three session-scoped actions: import a JSON file (persisted to captures.db
 * server-side and opened as a fresh saved session), export the current
 * session, clear the in-view messages. Mirrors `ThemeToggle`'s pattern so the
 * TopBar reads as a tight row of equally-sized 28px chips.
 */
export function SessionActionsMenu({ onImportResult }: SessionActionsMenuProps) {
    const [open, setOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const session = useMessagesStore((s) => s.session);
    const messageCount = useMessagesStore((s) => s.messages.length);
    const clear = useMessagesStore((s) => s.clear);

    const exportable = session !== null && messageCount > 0;

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const onImportClick = () => {
        setOpen(false);
        fileInputRef.current?.click();
    };
    const onExportClick = () => {
        setOpen(false);
        const state = useMessagesStore.getState();
        if (state.session && state.messages.length > 0) {
            downloadSessionExport(state.session, state.messages);
        }
    };
    const onClearClick = () => {
        setOpen(false);
        clear();
    };

    const onFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset so picking the same filename twice still re-fires `change`.
        event.target.value = '';
        if (!file) return;
        setImporting(true);
        try {
            const result = await importSession(file);
            await refreshSavedSessions();
            useDiscoveryStore.getState().setSelected(replayUrlFor(result.id));
            onImportResult?.(
                `imported ${file.name} · #${result.id} · ${result.messageCount} message${result.messageCount === 1 ? '' : 's'}`,
                'success',
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onImportResult?.(`import failed: ${message}`, 'warn');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div ref={wrapRef} className="relative">
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={onFilePicked}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
            />
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title="Session actions — import file · export · clear"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="session actions"
                disabled={importing}
                className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-sm border font-mono text-[14px] leading-none transition-colors',
                    open
                        ? 'border-line-strong bg-surface-rowHover text-ink-primary'
                        : 'border-line bg-surface-row text-ink-secondary hover:border-line-strong hover:text-ink-primary',
                    importing && 'cursor-progress opacity-60',
                )}
            >
                <span aria-hidden>{importing ? '⋯' : '⋯'}</span>
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[180px] overflow-hidden rounded-sm border border-line bg-surface-elev p-1 font-mono text-[11px] uppercase tracking-widest shadow-lg"
                >
                    <MenuItem
                        icon="↑"
                        label="import"
                        onClick={onImportClick}
                        title="Open a session JSON exported earlier — yours or someone else's."
                    />
                    <MenuItem
                        icon="↓"
                        label="export"
                        onClick={onExportClick}
                        disabled={!exportable}
                        title="Download this session as self-contained JSON."
                        disabledTitle="Nothing to export yet — wait for the first message."
                    />
                    <MenuItem
                        icon="×"
                        label="clear"
                        onClick={onClearClick}
                        title="Hide current messages from view. They come back when you reopen the session — nothing is deleted from disk."
                    />
                </div>
            )}
        </div>
    );
}

interface MenuItemProps {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    disabledTitle?: string;
}

function MenuItem({ icon, label, onClick, disabled, title, disabledTitle }: MenuItemProps) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={onClick}
            title={disabled ? disabledTitle : title}
            className={cn(
                'flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left transition-colors',
                disabled
                    ? 'cursor-not-allowed text-ink-dim opacity-50'
                    : 'text-ink-muted hover:bg-surface-rowHover hover:text-ink-secondary',
            )}
        >
            <span aria-hidden className="w-4 text-center text-[13px] leading-none">
                {icon}
            </span>
            <span className="flex-1">{label}</span>
        </button>
    );
}
