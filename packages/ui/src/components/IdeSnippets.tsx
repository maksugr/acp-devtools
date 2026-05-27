import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { fetchServerInfo } from '../api/info';

type Tab = 'zed' | 'jetbrains';

const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'zed', label: 'Zed' },
    { id: 'jetbrains', label: 'JetBrains' },
];

const PATH_PLACEHOLDER = '/absolute/path/to/acp-devtools';

function buildZedSnippet(binaryPath: string): string {
    // Minimal form: when the IDE spawns `acp-devtools` with no args and a
    // piped stdin, the CLI auto-expands to `proxy --agent claude-code`.
    // `type: "custom"` distinguishes a user-defined entry from Zed's own
    // built-in agent registry (`type: "registry"`).
    return JSON.stringify(
        {
            agent_servers: {
                'Claude Code (via ACP Devtools)': {
                    type: 'custom',
                    command: binaryPath,
                },
            },
        },
        null,
        4,
    );
}

interface CopyButtonProps {
    text: string;
    label?: string;
}

function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
    const [done, setDone] = useState(false);
    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            setDone(false);
        }
    };
    return (
        <button
            type="button"
            onClick={onCopy}
            className={cn(
                'rounded border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors',
                done
                    ? 'border-accent-out text-accent-out'
                    : 'text-ink-secondary hover:border-ink-secondary hover:text-ink-primary',
            )}
        >
            {done ? 'Copied' : label}
        </button>
    );
}

export function IdeSnippets() {
    const [tab, setTab] = useState<Tab>('zed');
    const [binaryPath, setBinaryPath] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        fetchServerInfo()
            .then((info) => {
                if (alive) setBinaryPath(info.binaryPath);
            })
            .catch(() => {
                // `/api/info` is not present on very old servers; fall back to placeholder.
            });
        return () => {
            alive = false;
        };
    }, []);

    const resolvedPath = binaryPath ?? PATH_PLACEHOLDER;
    const isPlaceholder = binaryPath === null;

    const snippets = useMemo(
        () => ({
            zed: buildZedSnippet(resolvedPath),
            jetbrainsName: 'Claude Code (via ACP Devtools)',
        }),
        [resolvedPath],
    );

    return (
        <div className="rounded border border-line bg-surface-base">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors',
                            tab === t.id
                                ? 'bg-surface-elev text-ink-primary'
                                : 'text-ink-secondary hover:text-ink-primary',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'zed' && (
                <div className="px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                            ~/.config/zed/settings.json
                        </span>
                        <CopyButton text={snippets.zed} />
                    </div>
                    <pre className="overflow-x-auto rounded border border-line bg-surface-elev/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-primary">
                        {snippets.zed}
                    </pre>
                    <p className="mt-2 font-sans text-[11px] leading-relaxed text-ink-secondary">
                        Open Zed, paste into <span className="font-mono">settings.json</span>{' '}
                        (Cmd+,), pick the new agent in the right-side panel, send a prompt. The CLI
                        auto-proxies <span className="font-mono">@zed-industries/claude-code-acp</span>{' '}
                        when launched with no args.
                    </p>
                    <PathHint isPlaceholder={isPlaceholder} />
                </div>
            )}

            {tab === 'jetbrains' && (
                <div className="px-3 py-3">
                    <p className="mb-2 font-sans text-[11px] leading-relaxed text-ink-secondary">
                        Settings (Cmd+,) → search <span className="font-mono">agent</span> → open
                        the AI Assistant / Junie agent-servers page → add a new entry with these
                        fields (no arguments needed):
                    </p>
                    <div className="grid gap-2">
                        <Field label="Name" value={snippets.jetbrainsName} />
                        <Field label="Command" value={resolvedPath} />
                    </div>
                    <p className="mt-3 font-sans text-[11px] leading-relaxed text-ink-secondary">
                        JetBrains IDEs require an absolute <span className="font-mono">command</span>.
                        See <span className="font-mono">examples/jetbrains-config.md</span> if the
                        agent-servers page is not where the search suggests.
                    </p>
                    <PathHint isPlaceholder={isPlaceholder} />
                </div>
            )}

        </div>
    );
}

interface PathHintProps {
    isPlaceholder: boolean;
}

function PathHint({ isPlaceholder }: PathHintProps) {
    if (isPlaceholder) {
        return (
            <div className="mt-3 rounded border border-line border-dashed bg-surface-elev/40 px-3 py-2 font-sans text-[11px] leading-relaxed text-ink-secondary">
                You're viewing the UI through a development server, so the absolute binary path
                couldn't be auto-detected. After running{' '}
                <span className="font-mono">npm run build:full</span> in the repo and{' '}
                <span className="font-mono">npm link</span> inside{' '}
                <span className="font-mono">packages/cli/</span>, find the path with{' '}
                <span className="font-mono">which acp-devtools</span> and replace the placeholder
                above.
            </div>
        );
    }
    // Subtle reassurance line — confirms what was auto-resolved.
    return (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ink-dim">
            path auto-resolved · verify with <span className="text-ink-secondary">which acp-devtools</span>
        </p>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center gap-2 rounded border border-line bg-surface-elev/60 px-3 py-1.5">
            <span className="w-20 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                {label}
            </span>
            <span className="flex-1 truncate font-mono text-[11px] text-ink-primary">{value}</span>
            <CopyButton text={value} />
        </div>
    );
}
