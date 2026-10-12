import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SectionNavItem {
    key: string;
    label: string;
    active: boolean;
    onClick: () => void;
}

// One row of words, not a row of buttons: the sections read as a group, and the open one is the white one with a line in
// the accent color under it.
const TAB = 'relative px-0.5 py-2 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0';
const tone = (on: boolean) => (on ? 'text-white' : 'text-[#9a9a9a] hover:text-white');
const Underline = () => <span className="absolute left-0 right-0 bottom-0.5 h-0.5 rounded-full bg-[var(--k-accent)]" />;

/**
 * The horizontal layout's sections (Search, Library, Glossary, ...), as a row of names with the open one underlined:
 * every one of them while there's room, and as the window narrows, the ones that no longer fit move, from the end, into
 * a More dropdown at the end of the row. No name is ever squeezed or cut short. With the open section among the ones in
 * the dropdown, More is drawn as the open one.
 *
 * Every name is also drawn once, invisibly, at its natural width, so the row knows how wide each is (the same way
 * ui/UnderlineTabs.tsx's More works). It takes whatever width its parent leaves it, and lays its names out from the right.
 */
export function SectionNav({ items }: { items: SectionNavItem[] }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(items.length);
    const [open, setOpen] = useState(false);

    useLayoutEffect(() => {
        const box = boxRef.current;
        const measure = measureRef.current;
        if (!box || !measure) return;
        const fit = () => {
            const widths = [...measure.children].map(c => (c as HTMLElement).offsetWidth);
            const moreWidth = widths.pop() ?? 0; // the last one measured is More itself
            const gap = parseFloat(getComputedStyle(measure).columnGap) || 0;
            const room = box.clientWidth;
            const all = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
            if (all <= room) { setShown(widths.length); return; }
            let used = moreWidth;
            let n = 0;
            while (n < widths.length && used + gap + widths[n] <= room) { used += gap + widths[n]; n++; }
            setShown(n);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(box);
        observer.observe(measure);
        return () => observer.disconnect();
    }, [items.length]);

    // A click outside, or Esc, closes the dropdown.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const visible = items.slice(0, shown);
    const hidden = items.slice(shown);
    useEffect(() => { if (hidden.length === 0) setOpen(false); }, [hidden.length]);
    const activeHidden = hidden.some(i => i.active);
    const moreLabel = (
        <>
            More
            <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </>
    );

    return (
        <div ref={boxRef} className="relative flex-1 min-w-0">
            <div className="flex justify-end gap-6">
                {visible.map(item => (
                    <button key={item.key} onClick={item.onClick} aria-current={item.active ? 'page' : undefined} className={`${TAB} ${tone(item.active)}`}>
                        {item.label}
                        {item.active && <Underline />}
                    </button>
                ))}
                {hidden.length > 0 && (
                    <div ref={moreRef} className="relative shrink-0">
                        <button
                            onClick={() => setOpen(o => !o)}
                            aria-haspopup="menu"
                            aria-expanded={open}
                            title="More sections"
                            className={`${TAB} flex items-center gap-1 ${tone(open || activeHidden)}`}
                        >
                            {moreLabel}
                            {activeHidden && <Underline />}
                        </button>
                        {open && (
                            <div role="menu" className="absolute top-full right-0 mt-2 min-w-36 w-max bg-[#272727] border border-[#3f3f3f] rounded-lg shadow-xl z-51 overflow-hidden">
                                {hidden.map(item => (
                                    <button
                                        key={item.key}
                                        role="menuitem"
                                        onClick={() => { setOpen(false); item.onClick(); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-[#3f3f3f] cursor-pointer ${item.active ? 'text-white font-bold' : 'text-gray-300'}`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* The invisible copy the widths are read from: each name, then More. In a box of no size that clips
                it, so it's laid out at its full width without ever adding to what the page can scroll to. */}
            <div aria-hidden className="absolute left-0 top-0 w-0 h-0 overflow-hidden invisible pointer-events-none">
                <div ref={measureRef} className="w-max flex gap-6">
                    {items.map(item => <span key={item.key} className={TAB}>{item.label}</span>)}
                    <span className={`${TAB} flex items-center gap-1`}>{moreLabel}</span>
                </div>
            </div>
        </div>
    );
}
