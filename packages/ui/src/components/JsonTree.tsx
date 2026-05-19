import { useState } from 'react';
import { cn } from '../lib/cn';

interface JsonTreeProps {
    value: unknown;
    name?: string;
    depth?: number;
    defaultExpanded?: boolean;
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

export function JsonTree({ value, name, depth = 0, defaultExpanded }: JsonTreeProps) {
    const expandable = isObject(value) || Array.isArray(value);
    const childCount = isObject(value)
        ? Object.keys(value).length
        : Array.isArray(value)
          ? value.length
          : 0;

    const shouldDefaultExpand =
        defaultExpanded ?? (depth < 2 && childCount <= COLLAPSE_THRESHOLD);
    const [open, setOpen] = useState<boolean>(shouldDefaultExpand);

    const keyLabel = name !== undefined ? <KeyLabel name={name} /> : null;

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
                              />
                          ))
                        : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                              <JsonTree key={k} value={v} name={k} depth={depth + 1} />
                          ))}
                    <div className="text-ink-secondary">{closer}</div>
                </div>
            )}
        </div>
    );
}

function KeyLabel({ name }: { name: string }) {
    const isIndex = /^\d+$/.test(name);
    return (
        <span className={cn(isIndex ? 'text-ink-muted' : 'text-ink-secondary')}>
            {isIndex ? `${name}:` : `"${name}":`}
        </span>
    );
}
