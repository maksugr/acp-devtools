import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { useMessagesStore } from '../store/messagesStore';

const SPEEDS = [0.5, 1, 2, 4, 8];

export function ReplayControls() {
    const messages = useMessagesStore((s) => s.messages);
    const playback = useMessagesStore((s) => s.playback);
    const setPlayhead = useMessagesStore((s) => s.setPlayhead);
    const setPlaying = useMessagesStore((s) => s.setPlaying);
    const setSpeed = useMessagesStore((s) => s.setPlaybackSpeed);

    const minSeq = messages.length > 0 ? messages[0]!.seq : 0;
    const maxSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : 0;
    const playhead = playback.playhead;
    // null = parked at the start; the scrubber sits at the far left and the
    // counter reads 0. Everything is already on screen — the playhead only
    // tracks position, it never hides frames.
    const sliderValue = playhead ?? minSeq;
    const atEnd = playhead !== null && playhead >= maxSeq;

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!playback.playing) return;
        if (atEnd) {
            setPlaying(false);
            return;
        }
        // From the start (null) the first tick reaches the first frame.
        const currentIdx =
            playhead === null ? -1 : messages.findIndex((m) => m.seq === playhead);
        const nextMsg = messages[currentIdx + 1];
        if (!nextMsg) {
            setPlaying(false);
            return;
        }
        const currentMsg = currentIdx >= 0 ? messages[currentIdx] : undefined;
        const delta = currentMsg ? nextMsg.timestamp - currentMsg.timestamp : 0;
        const delay = Math.max(15, Math.min(1500, delta / playback.speed));
        timerRef.current = setTimeout(() => {
            setPlayhead(nextMsg.seq);
        }, delay);
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [playback.playing, playback.speed, playhead, messages, atEnd, setPlayhead, setPlaying]);

    if (messages.length === 0) return null;

    const handleSlider = (value: number) => {
        setPlayhead(value);
        // Pause when user scrubs manually.
        if (playback.playing) setPlaying(false);
    };

    const togglePlay = () => {
        if (atEnd) {
            // Restart from the top; the loop's first tick lands on frame one.
            setPlayhead(null);
            setPlaying(true);
        } else {
            setPlaying(!playback.playing);
        }
    };

    return (
        <div className="flex items-center gap-3 border-t border-line bg-surface-elev/70 px-4 py-2 font-mono text-[11px]">
            <button
                type="button"
                onClick={togglePlay}
                className={cn(
                    'inline-flex h-6 w-12 items-center justify-center rounded-sm border font-semibold uppercase tracking-widest transition-colors',
                    playback.playing
                        ? 'border-accent-warn/50 bg-accent-warn/10 text-accent-warn'
                        : 'border-accent-out/50 bg-accent-out/10 text-accent-out',
                )}
                title={playback.playing ? 'pause' : atEnd ? 'restart playback' : 'play'}
            >
                {playback.playing ? '❚❚' : atEnd ? '↺' : '▶'}
            </button>
            <span className="w-20 shrink-0 text-right text-ink-secondary">
                {String(playhead ?? 0).padStart(3, '0')} / {String(maxSeq).padStart(3, '0')}
            </span>
            <input
                type="range"
                min={minSeq}
                max={maxSeq}
                value={sliderValue}
                onChange={(e) => handleSlider(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer accent-accent-out"
            />
            <div className="flex shrink-0 items-center gap-1">
                {SPEEDS.map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => setSpeed(s)}
                        className={cn(
                            'rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-widest transition-colors',
                            playback.speed === s
                                ? 'border-accent-out/50 bg-accent-out/10 text-accent-out'
                                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink-secondary',
                        )}
                        title={`${s}× speed`}
                    >
                        {s}×
                    </button>
                ))}
            </div>
        </div>
    );
}
