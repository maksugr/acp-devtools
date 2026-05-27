import { useEffect, useState } from 'react';

interface DrawerAnimationState {
    /** True while the drawer should occupy the DOM (mounted but possibly mid-exit). */
    rendered: boolean;
    /** True while the drawer should display its "open" transform (translate-x-0, opacity-1). */
    visible: boolean;
}

/**
 * Drives the two-state mount cycle that a CSS transition needs:
 *
 *   open=true   → mount immediately, next frame switch to "visible"
 *   open=false  → switch to "hidden", unmount after `duration` ms
 *
 * Keeps the existing `if (!rendered) return null` contract (so component tests
 * that assert "renders nothing when closed" keep working) while letting the
 * outer element animate `translate-x-full → translate-x-0` and the backdrop
 * fade in/out on its own timing.
 */
export function useDrawerAnimation(open: boolean, duration = 200): DrawerAnimationState {
    const [rendered, setRendered] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setRendered(true);
            // Double-RAF: a single RAF callback can fire before the browser
            // actually paints the just-committed initial state (translate-x-full,
            // opacity-0). When that happens, CSS transitions skip the start
            // frame and the drawer appears to jolt into place. Waiting one
            // extra frame guarantees the paint happens between commits.
            let id2: number | null = null;
            const id1 = requestAnimationFrame(() => {
                id2 = requestAnimationFrame(() => setVisible(true));
            });
            return () => {
                cancelAnimationFrame(id1);
                if (id2 !== null) cancelAnimationFrame(id2);
            };
        }
        setVisible(false);
        const id = setTimeout(() => setRendered(false), duration);
        return () => clearTimeout(id);
    }, [open, duration]);

    return { rendered, visible };
}
