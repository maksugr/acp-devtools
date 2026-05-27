import { useMemo } from 'react';
import {
    buildRequestIndex,
    useMessagesStore,
} from '../store/messagesStore';
import { formatLatency, percentile } from '../lib/format';
import { buildValidationMap, summarizeValidation } from '../lib/validation';

export function StatsBar() {
    const messages = useMessagesStore((s) => s.messages);
    const replayDone = useMessagesStore((s) => s.replayDone);

    const stats = useMemo(() => {
        let req = 0;
        let res = 0;
        let note = 0;
        let err = 0;
        const tsBySeq = new Map<number, number>();
        for (const m of messages) {
            tsBySeq.set(m.seq, m.timestamp);
            switch (m.kind) {
                case 'request':
                    req += 1;
                    break;
                case 'response':
                    res += 1;
                    break;
                case 'notification':
                    note += 1;
                    break;
                case 'error':
                    err += 1;
                    break;
                default:
                    break;
            }
        }
        const pairs = buildRequestIndex(messages);
        const latencies: number[] = [];
        for (const m of messages) {
            if (m.kind !== 'response' && m.kind !== 'error') continue;
            const reqSeq = pairs.get(m.seq);
            if (reqSeq === undefined) continue;
            const reqTs = tsBySeq.get(reqSeq);
            if (reqTs === undefined) continue;
            latencies.push(m.timestamp - reqTs);
        }
        latencies.sort((a, b) => a - b);
        const p50 = latencies.length ? percentile(latencies, 50) : null;
        const p99 = latencies.length ? percentile(latencies, 99) : null;
        const spec = summarizeValidation(buildValidationMap(messages));
        return { total: messages.length, req, res, note, err, p50, p99, spec };
    }, [messages]);

    return (
        <footer className="flex items-center justify-between gap-6 border-t border-line bg-surface-elev/80 px-5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
            <div className="flex items-center gap-5">
                <Stat label="msgs" value={stats.total} tone="primary" />
                <Stat label="req" value={stats.req} tone="out" />
                <Stat label="rsp" value={stats.res} tone="in" />
                <Stat label="ntf" value={stats.note} tone="note" />
                <Stat label="err" value={stats.err} tone={stats.err > 0 ? 'error' : 'muted'} />
            </div>
            <div className="flex items-center gap-5">
                <Stat
                    label="p50"
                    value={stats.p50 !== null ? formatLatency(stats.p50) : '—'}
                    tone="primary"
                />
                <Stat
                    label="p99"
                    value={stats.p99 !== null ? formatLatency(stats.p99) : '—'}
                    tone="primary"
                />
                {stats.spec.checked > 0 && (
                    <SpecStat
                        invalidFrames={stats.spec.invalidFrames}
                        totalErrors={stats.spec.totalErrors}
                        affectedMethods={stats.spec.affectedMethods}
                    />
                )}
                <span className={replayDone ? 'text-accent-ok' : 'text-ink-muted'}>
                    {replayDone ? '● replay synced' : '◌ awaiting replay'}
                </span>
            </div>
        </footer>
    );
}

function SpecStat({
    invalidFrames,
    totalErrors,
    affectedMethods,
}: {
    invalidFrames: number;
    totalErrors: number;
    affectedMethods: string[];
}) {
    if (invalidFrames === 0) {
        return (
            <span className="inline-flex items-baseline gap-1" title="every frame validates against the ACP schema">
                <span>spec</span>
                <span className="text-accent-ok">✓</span>
            </span>
        );
    }
    const tooltip =
        `${totalErrors} schema error${totalErrors === 1 ? '' : 's'} in ` +
        `${invalidFrames} frame${invalidFrames === 1 ? '' : 's'}` +
        (affectedMethods.length ? ` · methods: ${affectedMethods.join(', ')}` : '');
    return (
        <span className="inline-flex items-baseline gap-1" title={tooltip}>
            <span>spec</span>
            <span className="text-accent-error">⚠ {invalidFrames}</span>
        </span>
    );
}

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string | number;
    tone: 'primary' | 'out' | 'in' | 'note' | 'error' | 'muted';
}) {
    const cls =
        tone === 'primary'
            ? 'text-ink-primary'
            : tone === 'out'
              ? 'text-accent-out'
              : tone === 'in'
                ? 'text-accent-in'
                : tone === 'note'
                  ? 'text-accent-note'
                  : tone === 'error'
                    ? 'text-accent-error'
                    : 'text-ink-muted';
    return (
        <span className="inline-flex items-baseline gap-1">
            <span>{label}</span>
            <span className={cls}>{value}</span>
        </span>
    );
}
