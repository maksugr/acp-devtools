import { useState } from 'react';
import type { SpecInfo } from '@acp-devtools/core/acp/spec-decoder/browser';
import { cn } from '../lib/cn';
import { SpecHint } from './SpecHint';

interface JsonTreeProps {
    value: unknown;
    name?: string;
    depth?: number;
    defaultExpanded?: boolean;
    /** Current path within the payload root — used to look up spec metadata. */
    path?: string[];
    /**
     * Optional resolver returning ACP spec metadata for a path within the
     * payload. When passed, each key shows a description tooltip (ⓘ) when
     * the spec has one, and an `⚠ ext` badge for unknown / extension fields.
     */
    getSpec?: (path: string[]) => SpecInfo | null;
}

const COLLAPSE_THRESHOLD = 6;

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function valueClass(v: unknown): string {
    if (v === null) return 'text-accent-error';
    switch (typeof v) {
        case 'string':
            return 'text-accent-out';
        case 'number':
            return 'text-accent-in';
        case 'boolean':
            return 'text-accent-note';
        default:
            return 'text-ink-secondary';
    }
}

function renderPrimitive(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
}

export function JsonTree({
    value,
    name,
    depth = 0,
    defaultExpanded,
    path = [],
    getSpec,
}: JsonTreeProps) {
    const expandable = isObject(value) || Array.isArray(value);
    const childCount = isObject(value)
        ? Object.keys(value).length
        : Array.isArray(value)
          ? value.length
          : 0;

    const shouldDefaultExpand =
        defaultExpanded ?? (depth < 2 && childCount <= COLLAPSE_THRESHOLD);
    const [open, setOpen] = useState<boolean>(shouldDefaultExpand);

    const spec = name !== undefined && getSpec ? getSpec(path) : null;
    const keyLabel =
        name !== undefined ? <KeyLabel name={name} spec={spec} /> : null;

    if (!expandable) {
        return (
            <div className="flex items-baseline gap-2 font-mono text-xs leading-relaxed">
                {keyLabel}
                <span className={cn('whitespace-pre-wrap break-all', valueClass(value))}>
                    {renderPrimitive(value)}
                </span>
            </div>
        );
    }

    const isArray = Array.isArray(value);
    const opener = isArray ? '[' : '{';
    const closer = isArray ? ']' : '}';

    return (
        <div className="font-mono text-xs leading-relaxed">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="group/expand flex items-baseline gap-2 text-left hover:text-ink-primary"
            >
                <span
                    aria-hidden
                    className={cn(
                        'inline-block w-3 text-ink-muted transition-transform',
                        open ? 'rotate-90' : '',
                    )}
                >
                    ▸
                </span>
                {keyLabel}
                <span className="text-ink-secondary">{opener}</span>
                {!open && (
                    <span className="text-ink-muted">
                        {childCount} {isArray ? 'items' : 'keys'}
                    </span>
                )}
                {!open && <span className="text-ink-secondary">{closer}</span>}
            </button>
            {open && (
                <div className="ml-3 border-l border-line-grid pl-3">
                    {isArray
                        ? (value as unknown[]).map((item, i) => (
                              <JsonTree
                                  key={i}
                                  value={item}
                                  name={String(i)}
                                  depth={depth + 1}
                                  path={[...path, String(i)]}
                                  {...(getSpec ? { getSpec } : {})}
                              />
                          ))
                        : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                              <JsonTree
                                  key={k}
                                  value={v}
                                  name={k}
                                  depth={depth + 1}
                                  path={[...path, k]}
                                  {...(getSpec ? { getSpec } : {})}
                              />
                          ))}
                    <div className="text-ink-secondary">{closer}</div>
                </div>
            )}
        </div>
    );
}

function KeyLabel({ name, spec }: { name: string; spec: SpecInfo | null }) {
    const isIndex = /^\d+$/.test(name);
    const description = spec?.description ?? null;
    return (
        <span className="inline-flex items-baseline gap-1">
            <span className={cn(isIndex ? 'text-ink-muted' : 'text-ink-secondary')}>
                {isIndex ? `${name}:` : `"${name}":`}
            </span>
            {spec && !spec.inSpec && (
                <SpecBadge
                    tone={spec.isExtension ? 'extension' : 'unknown'}
                    explanation={
                        spec.isExtension
                            ? 'Extension — not declared in the ACP spec; contents are implementation-defined.'
                            : 'Unknown — this field is not declared in the ACP schema for this message.'
                    }
                />
            )}
            {spec?.inSpec && spec.isExtension && (
                <SpecBadge
                    tone="extension"
                    explanation="Extension — _meta payload is implementation-defined per ACP spec."
                />
            )}
            {description && (
                <SpecHint
                    label={<DescriptionBlock text={description} type={spec?.type} enumValues={spec?.enumValues} />}
                    tone="info"
                    className="text-ink-muted hover:text-ink-primary"
                    focusable
                >
                    <span aria-label={`spec: ${description.split('\n')[0]}`}>ⓘ</span>
                </SpecHint>
            )}
        </span>
    );
}

function DescriptionBlock({
    text,
    type,
    enumValues,
}: {
    text: string;
    type?: string;
    enumValues?: unknown[];
}) {
    return (
        <div className="space-y-1.5">
            {type && (
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                    <span className="text-accent-info">{type}</span>
                </div>
            )}
            <div className="whitespace-pre-wrap font-sans text-[12px] leading-snug text-ink-secondary">
                {text}
            </div>
            {enumValues && enumValues.length > 0 && (
                <div className="font-mono text-[10px] text-ink-muted">
                    enum: {enumValues.map((v) => JSON.stringify(v)).join(' · ')}
                </div>
            )}
        </div>
    );
}

function SpecBadge({
    tone,
    explanation,
}: {
    tone: 'extension' | 'unknown';
    explanation: string;
}) {
    const cls =
        tone === 'extension'
            ? 'border-accent-warn/40 bg-accent-warn/10 text-accent-warn'
            : 'border-accent-error/40 bg-accent-error/10 text-accent-error';
    return (
        <SpecHint
            label={<span className="font-sans">{explanation}</span>}
            tone={tone === 'extension' ? 'warn' : 'error'}
            focusable
        >
            <span
                className={cn(
                    'inline-flex items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-widest',
                    cls,
                )}
            >
                {tone === 'extension' ? '⚠ ext' : '⚠ unknown'}
            </span>
        </SpecHint>
    );
}
