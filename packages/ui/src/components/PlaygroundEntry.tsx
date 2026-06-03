import { useRef, useState, type DragEvent } from 'react';
import { cn } from '../lib/cn';
import { useMessagesStore } from '../store/messagesStore';
import {
    PLAYGROUND_URL_ALLOWLIST,
    fetchPlaygroundExport,
    parseExportSource,
    type LoadResult,
} from '../lib/playgroundLoad';

interface PlaygroundEntryProps {
    initialUrl?: string | null;
}

export function PlaygroundEntry({ initialUrl = null }: PlaygroundEntryProps) {
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(initialUrl !== null);
    const [dragOver, setDragOver] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const applyResult = (result: LoadResult, source: string) => {
        if (result.ok) {
            useMessagesStore.getState().loadFromExport(result.export);
            setError(null);
        } else {
            setError(`${source}: ${result.error}`);
        }
        setLoading(false);
    };

    const loadFile = async (file: File) => {
        setLoading(true);
        setError(null);
        try {
            const text = await file.text();
            applyResult(parseExportSource(text), file.name);
        } catch (err) {
            setError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            setLoading(false);
        }
    };

    const loadUrl = async (url: string) => {
        setLoading(true);
        setError(null);
        applyResult(await fetchPlaygroundExport(url), url);
    };

    // Single-shot ?url= boot — fire once if a URL was passed in.
    const bootUrlRef = useRef<string | null>(initialUrl);
    if (bootUrlRef.current !== null) {
        const url = bootUrlRef.current;
        bootUrlRef.current = null;
        void loadUrl(url);
    }

    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void loadFile(file);
    };

    return (
        <div className="flex h-full w-full items-center justify-center bg-grid">
            <div className="relative w-[min(720px,92%)] rounded-md border border-line bg-surface-elev/80 p-6 backdrop-blur-sm">
                <div className="mb-1 flex items-baseline gap-3">
                    <span className="font-display text-sm uppercase tracking-[0.18em] text-ink-muted">
                        acp.devtools
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                        playground
                    </span>
                </div>
                <h2 className="font-display text-2xl uppercase tracking-tight text-ink-primary">
                    Drop an exported session
                </h2>
                <p className="mt-2 font-sans text-sm leading-relaxed text-ink-secondary">
                    The playground renders ACP session exports client-side. Nothing leaves
                    your browser. Generate exports with <code className="font-mono">acp-devtools export &lt;id&gt;</code>{' '}
                    — auth headers and proxy tokens are redacted by default.
                </p>

                <div
                    role="button"
                    tabIndex={0}
                    aria-label="Drop session export here or click to pick a file"
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            inputRef.current?.click();
                        }
                    }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={cn(
                        'mt-5 flex h-40 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed text-center transition-colors',
                        dragOver
                            ? 'border-accent-out bg-accent-out/10'
                            : 'border-line bg-surface-base/40 hover:border-ink-muted',
                    )}
                >
                    <span className="font-display text-sm uppercase tracking-[0.18em] text-ink-muted">
                        {loading ? 'Loading…' : 'Drop .json here'}
                    </span>
                    <span className="mt-1 font-mono text-[11px] text-ink-dim">
                        or click to pick a file
                    </span>
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void loadFile(file);
                            e.target.value = '';
                        }}
                    />
                </div>

                <form
                    className="mt-4 flex items-center gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = urlInput.trim();
                        if (trimmed) void loadUrl(trimmed);
                    }}
                >
                    <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://raw.githubusercontent.com/…/session.json"
                        className="flex-1 rounded-sm border border-line bg-surface-base px-3 py-2 font-mono text-[12px] text-ink-primary outline-none focus:border-ink-muted"
                        aria-label="Load session from URL"
                    />
                    <button
                        type="submit"
                        disabled={loading || urlInput.trim().length === 0}
                        className="rounded-sm border border-line bg-surface-base px-3 py-2 font-display text-[11px] uppercase tracking-widest text-ink-secondary transition-colors hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Load
                    </button>
                </form>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-dim">
                    URL allowlist: {PLAYGROUND_URL_ALLOWLIST.join(', ')}. Gists are public —
                    don't use this for anything you wouldn't post on Twitter.
                </p>

                {error && (
                    <p className="mt-3 font-mono text-[11px] text-accent-error">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}
