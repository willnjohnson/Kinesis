import { useCallback, useRef, useState, type MouseEvent } from 'react';
import { ClipboardCopy, FileCode } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { selectionToMarkdown } from '../lib/selection-markdown';

/**
 * Makes a reading view's text selectable (the rest of the app isn't: index.css), for the Sidebar's Transcript and Summary,
 * a Glossary definition and a Biography's description. Spread `props` on the element holding the text, give it
 * SELECTABLE_CLASS too, and render `menu`.
 *
 *  - Right-clicking with text selected in it opens a menu: Copy as Plain Text, Copy as Markdown (the selection turned back
 *    into markdown, links and [1:23] timestamps included: lib/selection-markdown.ts), then whatever `extraItems` adds (the
 *    Sidebar's Cite in note). With nothing selected, a right-click does whatever it did before (a biography link's own
 *    menu, saving an image).
 *  - Ctrl+A selects just this view's text, once it's been clicked, not every bit of selectable text in the window.
 */
export function useSelectableText(extraItems?: (selection: SelectedText) => ContextMenuItem[]) {
    const ref = useRef<HTMLDivElement>(null);
    const [menu, setMenu] = useState<{ x: number; y: number } & SelectedText | null>(null);

    const onContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
        const root = ref.current;
        const sel = window.getSelection();
        if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        e.preventDefault();
        e.stopPropagation();
        // Read now: clicking the menu could change the selection before an item runs.
        const before = document.createRange();
        before.selectNodeContents(root);
        before.setEnd(range.startContainer, range.startOffset);
        setMenu({ x: e.clientX, y: e.clientY, plain: sel.toString().trim(), markdown: selectionToMarkdown(range, root), before: before.toString() });
    }, []);

    const onMouseDown = useCallback(() => { activePane = ref.current; }, []);

    const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };
    const items: ContextMenuItem[] = menu ? [
        { label: 'Copy as Plain Text', icon: ClipboardCopy, onClick: () => copy(menu.plain) },
        { label: 'Copy as Markdown', icon: FileCode, onClick: () => copy(menu.markdown) },
        ...(extraItems ? extraItems(menu) : []),
    ] : [];

    installGlobalListeners();
    return {
        props: { ref, onContextMenu, onMouseDown },
        menu: menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />,
    };
}

/** What was selected when the menu opened: as plain text, as Markdown, and the view's text before it (a transcript's
 *  last timestamp before the selection is where it was said: lib/notes.ts's lastTimeBefore). */
export interface SelectedText { plain: string; markdown: string; before: string }

/** The class that opts an element's text back into selection (see index.css). */
export const SELECTABLE_CLASS = 'k-selectable';

// The reading view last clicked in, which Ctrl+A selects. Cleared by a click anywhere else (a dialog opened over it, the
// search bar, ...), so Ctrl+A there does its usual thing.
let activePane: HTMLElement | null = null;
let installed = false;

function installGlobalListeners() {
    if (installed) return;
    installed = true;
    document.addEventListener('mousedown', (e) => {
        if (activePane && !activePane.contains(e.target as Node)) activePane = null;
    }, true);
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || e.altKey || e.shiftKey) return;
        if (!activePane?.isConnected) return;
        // In a field, Ctrl+A is the field's.
        const focused = document.activeElement as HTMLElement | null;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) return;
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(activePane);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    });
}
