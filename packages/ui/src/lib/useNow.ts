import { useEffect, useState } from 'react';

/**
 * Re-render every `intervalMs` so components that show relative timestamps
 * (e.g. "47m alive", "idle 12m") update without per-message work.
 */
export function useNow(intervalMs = 5000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
