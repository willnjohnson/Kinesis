import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import { SnippetCard } from './GlossaryPreview';
import { inlineMarkdown } from '../lib/preview-markdown';

export interface ContextMenuItem {
    label: string;
    icon?: ElementType;
    onClick: () => void;
    disabled?: boolean;
    /** Drawn in red (deleting). */
    danger?: boolean;
    /** A line above this item, to set a group apart. */
    divider?: boolean;
    /** Quiet text at the right end (a shortcut). */
    hint?: string;
    /** While the pointer rests on the item, a card beside the menu shows what this returns (markdown; null for nothing). */
    peek?: { title: string; load: () => Promise<string | null> };
    /** A second level: resting on the item (or clicking it) opens these beside the menu, and one of them is what's picked
     *  (the item's own onClick isn't called). The Calendar's Change Priority. */
    submenu?: ContextMenuItem[];
    /** A check at the right end: the one of a submenu's choices that's in effect now. */
    checked?: boolean;
}

/** The look every menu shares (taken from the markdown editor's, MarkdownContextMenu.tsx): the panel, a row, and the line
 *  between groups. A row's text color is left to the caller (danger rows are red). */
export const MENU_PANEL = 'bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl p-1 select-none animate-in fade-in duration-100';
export const MENU_ROW = 'w-full flex items-center gap-2.5 px-3 h-8 rounded-lg text-xs text-left hover:bg-[#272727] transition-colors cursor-pointer disabled:text-gray-600 disabled:hover:bg-transparent disabled:cursor-default';
export const MENU_DIVIDER = 'my-1 h-px bg-[#2a2a2a]';

/**
 * A right-click menu at the pointer, in the same style as the workspace and window menus. It stays inside the window, and
 * closes on a choice, a click elsewhere, Esc, a scroll, a resize or the window losing focus. Esc is taken here (marked
 * handled) so it doesn't also close a dialog underneath.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
    const box = useRef<HTMLDivElement>(null);
    const at = useMenuPlace(box, x, y);
    useMenuDismiss(box, onClose);
    // The card an item with `peek` shows beside the menu, after the pointer has rested on it a moment. It goes to the right of
    // the menu, or the left if the window cuts it off there.
    // The pointer can move onto the card (to copy from it): leaving an item or the card only closes it after a moment, and going
    // onto the item or the card in that time keeps it open.
    const [peek, setPeek] = useState<{ rect: DOMRect; title: string; markdown: string; full: string } | null>(null);
    const peekTimer = useRef(0);
    const leaveTimer = useRef(0);
    const peeking = useRef<ContextMenuItem | null>(null);
    useEffect(() => () => { window.clearTimeout(peekTimer.current); window.clearTimeout(leaveTimer.current); }, []);
    const keepPeek = () => window.clearTimeout(leaveTimer.current);
    const startPeek = (item: ContextMenuItem, el: HTMLElement) => {
        keepPeek();
        window.clearTimeout(peekTimer.current);
        peeking.current = item;
        if (!item.peek) { setPeek(null); return; }
        const { title, load } = item.peek;
        peekTimer.current = window.setTimeout(() => {
            load().then(text => {
                // The pointer may have moved to another item while it loaded.
                if (text && peeking.current === item && el.isConnected) setPeek({ rect: el.getBoundingClientRect(), title, markdown: inlineMarkdown(text.slice(0, 2500)), full: text });
            }).catch(() => {});
        }, 250);
    };
    const endPeekSoon = () => {
        keepPeek();
        leaveTimer.current = window.setTimeout(() => {
            window.clearTimeout(peekTimer.current);
            peeking.current = null;
            setPeek(null);
        }, 250);
    };
    // The item whose submenu is open, and where: level with its row, to the menu's right, or its left when the window
    // has no room there.
    const [sub, setSub] = useState<{ label: string; top: number; left: boolean } | null>(null);
    const openSub = (item: ContextMenuItem, row: HTMLElement) => {
        const menu = box.current?.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        if (!menu) return;
        setSub({ label: item.label, top: r.top - menu.top - 4, left: menu.right + 200 > window.innerWidth });
    };

    return createPortal(
        <div
            ref={box}
            role="menu"
            style={at}
            // Above the video sidebar and dialogs, below the title bar's own menus and the tooltip. Same look as the
            // markdown editor's menu (MarkdownContextMenu.tsx): rounded rows inset from the edge, so the hovered one stands out.
            className={`fixed z-[250] w-60 ${MENU_PANEL}`}
            onContextMenu={(e) => e.preventDefault()}
            // A portal still passes clicks up to the React parent (here, the card it was opened from, which would open the video).
            onClick={(e) => e.stopPropagation()}
        >
            {items.map(item => (
                <div key={item.label}>
                    {item.divider && <div className={MENU_DIVIDER} />}
                    <button
                        role="menuitem"
                        disabled={item.disabled}
                        aria-haspopup={item.submenu ? 'menu' : undefined}
                        aria-expanded={item.submenu ? sub?.label === item.label : undefined}
                        onMouseEnter={(e) => { startPeek(item, e.currentTarget); if (item.submenu) openSub(item, e.currentTarget); else setSub(null); }}
                        onMouseLeave={endPeekSoon}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (item.submenu) { openSub(item, e.currentTarget); return; }
                            onClose();
                            item.onClick();
                        }}
                        className={`${MENU_ROW} ${item.danger ? 'text-red-400' : 'text-gray-200'} ${item.submenu && sub?.label === item.label ? 'bg-[#272727]' : ''}`}
                    >
                        {item.icon && <item.icon className={`w-3.5 h-3.5 shrink-0 ${item.danger || item.disabled ? '' : 'text-[#aaaaaa]'}`} />}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint && <span className="text-[10px] text-[#666666]">{item.hint}</span>}
                        {item.checked && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />}
                        {item.submenu && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#666666]" />}
                    </button>
                    {item.submenu && sub?.label === item.label && (
                        <div
                            role="menu"
                            style={{ top: sub.top, ...(sub.left ? { right: '100%' } : { left: '100%' }) }}
                            className={`absolute w-44 ${sub.left ? 'mr-1' : 'ml-1'} ${MENU_PANEL}`}
                        >
                            {item.submenu.map(choice => (
                                <button
                                    key={choice.label}
                                    role="menuitem"
                                    disabled={choice.disabled}
                                    onClick={(e) => { e.stopPropagation(); onClose(); choice.onClick(); }}
                                    className={`${MENU_ROW} ${choice.danger ? 'text-red-400' : 'text-gray-200'}`}
                                >
                                    {choice.icon && <choice.icon className="w-3.5 h-3.5 shrink-0" />}
                                    <span className="flex-1 truncate">{choice.label}</span>
                                    {choice.checked && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}
            {peek && <SnippetCard anchor={peek.rect} side="right" tone="menu" title={peek.title} markdown={peek.markdown} copyText={peek.full} onMouseEnter={keepPeek} onMouseLeave={endPeekSoon} />}
        </div>,
        document.body,
    );
}

/** Where a menu opened at the pointer goes: at the pointer, kept inside the window (measured once it is drawn), or
 *  above the pointer instead of below it when `above` and there isn't room beneath (a menu from the bottom bar). */
export function useMenuPlace(box: RefObject<HTMLElement | null>, x: number, y: number, above = false) {
    const [at, setAt] = useState({ left: x, top: y });
    useLayoutEffect(() => {
        const el = box.current;
        if (!el) return;
        // Placed again whenever the menu's size changes: one whose rows arrive after it opens (the Trash's) grows from
        // where it was put, and would otherwise run off the bottom of the window.
        const place = () => {
            const { offsetWidth: w, offsetHeight: h } = el;
            const flip = above && y + h + 6 > window.innerHeight;
            const next = {
                left: Math.max(6, Math.min(x, window.innerWidth - w - 6)),
                top: Math.max(6, Math.min(flip ? y - h : y, window.innerHeight - h - 6)),
            };
            setAt(prev => (prev.left === next.left && prev.top === next.top ? prev : next));
        };
        place();
        const observer = new ResizeObserver(place);
        observer.observe(el);
        return () => observer.disconnect();
    }, [box, x, y, above]);
    return at;
}

/** Closes a menu on a click elsewhere (which does nothing else), Esc, a scroll, a resize or the window losing focus.
 *  Esc is taken here (marked handled) so it doesn't also close a dialog underneath. */
export function useMenuDismiss(box: RefObject<HTMLElement | null>, onClose: () => void) {
    useEffect(() => {
        // A click outside only closes the menu: what was under it (a card, a button) does not also get the click. The
        // press closes it, and the click that completes that press is swallowed on its way in.
        const away = (e: MouseEvent) => {
            // Inside the menu, or on a card it opened that can be clicked (marked data-keep-open, and drawn elsewhere on the page).
            if (box.current?.contains(e.target as Node) || (e.target as Element).closest?.('[data-keep-open]')) return;
            onClose();
            if (e.button !== 0) return;
            const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
            document.addEventListener('click', swallow, { capture: true, once: true });
            // If the press never completes as a click (dragged away), don't leave the trap set for the next real click.
            window.setTimeout(() => document.removeEventListener('click', swallow, true), 600);
        };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
        document.addEventListener('mousedown', away, true);
        document.addEventListener('keydown', escape);
        document.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener('mousedown', away, true);
            document.removeEventListener('keydown', escape);
            document.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [box, onClose]);
}
