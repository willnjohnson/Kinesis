import type { MouseEvent } from 'react';

/** Per backdrop: whether the mouse was last pressed on the backdrop itself (not on the window over it). */
const pressedOnSelf = new WeakMap<EventTarget, boolean>();

/**
 * The props that make a dimmed backdrop close its window on a click outside it. A click counts only when the mouse was
 * both pressed and released on the backdrop: pressing in a text box and dragging out past the window's edge to select
 * text must not close it, though the browser calls that release a click on the backdrop. A click with no mouse press
 * behind it (`detail` 0: Esc and Back close the topmost window by clicking its backdrop, see App.tsx and lib/dialogs.ts)
 * always counts.
 *
 * `stop`: stop the click there, so it doesn't also reach a backdrop under this one.
 */
export function backdropProps(onClose: () => void, { stop = false }: { stop?: boolean } = {}) {
    return {
        onMouseDown: (e: MouseEvent<HTMLElement>) => {
            pressedOnSelf.set(e.currentTarget, e.target === e.currentTarget);
        },
        onClick: (e: MouseEvent<HTMLElement>) => {
            if (stop) e.stopPropagation();
            const synthetic = e.detail === 0;
            const outside = e.target === e.currentTarget && pressedOnSelf.get(e.currentTarget) === true;
            pressedOnSelf.delete(e.currentTarget);
            if (synthetic || outside) onClose();
        },
    };
}
