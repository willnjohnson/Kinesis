import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface UnderlineTab<T extends string> {
    id: T;
    label: string;
    icon: ElementType;
    /** The tooltip; the label when left out (labels can be cut short to fit). */
    title?: string;
    /** Something after the label (a count, say). */
    badge?: ReactNode;
}

interface Props<T extends string> {
    tabs: UnderlineTab<T>[];
    active: T;
    onChange: (id: T) => void;
    /** The row's layout and spacing (`mb-3` and the like go here). */
    className?: string;
    /** When the row is too narrow for every tab: 'truncate' cuts labels short with an ellipsis; 'more' keeps labels
     *  whole and moves the tabs that don't fit, from the end, into a More dropdown. */
    overflow?: 'truncate' | 'more';
}

const TAB_CLASS = 'flex items-center gap-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative';
const tabColor = (on: boolean) => (on ? 'text-white' : 'text-[#666666] hover:text-[#aaaaaa]');
const Underline = () => <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600" />;

/**
 * The app's small tab row: uppercase labels with an icon, the active one white with a red line under it (the
 * sidebar's Terms / Tags / Attachments..., the Export and History tabs, the tray popup). When the row is tight, labels
 * shrink to an ellipsis rather than wrap, or, with `overflow="more"`, the last tabs move into a More dropdown.
 */
export function UnderlineTabs<T extends string>(props: Props<T>) {
    if (props.overflow === 'more') return <TabsWithMore {...props} />;
    const { tabs, active, onChange, className = 'flex items-center gap-4' } = props;
    return (
        <div className={className}>
            {tabs.map(({ id, label, icon: Icon, title, badge }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    title={title ?? label}
                    className={`${TAB_CLASS} min-w-0 ${tabColor(active === id)}`}
                >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                    {badge}
                    {active === id && <Underline />}
                </button>
            ))}
        </div>
    );
}

/** The 'more' overflow: as many whole tabs as fit, then More with the rest. Every tab is also drawn once, invisibly,
 *  at its natural width, so the row knows how wide each one is without squeezing the visible ones to find out. */
function TabsWithMore<T extends string>({ tabs, active, onChange, className = 'flex items-center gap-4' }: Props<T>) {
    const rowRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(tabs.length);
    const [open, setOpen] = useState(false);

    // Re-measured when the row or any tab changes width (a badge appearing, the sidebar being resized).
    useLayoutEffect(() => {
        const row = rowRef.current;
        const measure = measureRef.current;
        if (!row || !measure) return;
        const fit = () => {
            const widths = [...measure.children].map(c => (c as HTMLElement).offsetWidth);
            const moreWidth = widths.pop() ?? 0; // the last one measured is More itself
            const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
            const room = row.clientWidth;
            const all = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
            if (all <= room) { setShown(widths.length); return; }
            let used = moreWidth;
            let n = 0;
            while (n < widths.length && used + gap + widths[n] <= room) { used += gap + widths[n]; n++; }
            setShown(n);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(row);
        observer.observe(measure);
        return () => observer.disconnect();
    }, [tabs.length]);

    // A click outside, or Esc, closes the dropdown.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    const visible = tabs.slice(0, shown);
    const hidden = tabs.slice(shown);
    // When the open tab is one of the hidden ones, More is drawn as the active tab.
    const activeHidden = hidden.some(t => t.id === active);

    const tab = ({ id, label, icon: Icon, title, badge }: UnderlineTab<T>, onClick?: () => void) => (
        <button
            key={id}
            type="button"
            onClick={onClick}
            title={title ?? label}
            className={`${TAB_CLASS} shrink-0 whitespace-nowrap ${tabColor(active === id)}`}
        >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{label}</span>
            {badge}
            {active === id && onClick && <Underline />}
        </button>
    );
    const moreLabel = (
        <>
            <span>More</span>
            <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </>
    );

    return (
        <div className="relative">
            <div ref={rowRef} className={className}>
                {visible.map(t => tab(t, () => onChange(t.id)))}
                {hidden.length > 0 && (
                    <div ref={moreRef} className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setOpen(o => !o)}
                            aria-haspopup="menu"
                            aria-expanded={open}
                            title={activeHidden ? tabs.find(t => t.id === active)?.label : `${hidden.length} more`}
                            className={`${TAB_CLASS} whitespace-nowrap ${tabColor(activeHidden || open)}`}
                        >
                            {moreLabel}
                            {activeHidden && <Underline />}
                        </button>
                        {open && (
                            <div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-[11rem] bg-[#141414] border border-[#333] rounded-xl py-1 shadow-xl">
                                {hidden.map(({ id, label, icon: Icon, badge }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { onChange(id); setOpen(false); }}
                                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-[#222222] transition-colors cursor-pointer ${active === id ? 'text-white' : 'text-gray-300'}`}
                                    >
                                        <Icon className="w-3.5 h-3.5 shrink-0" />
                                        <span className="flex-1 whitespace-nowrap">{label}</span>
                                        {badge}
                                        {active === id && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* The invisible copy every width is read from: each tab at full width, then More. In a box of no size that
                clips it: laid out at its full width all the same, but never part of what the pane around it can scroll to
                (an invisible row wider than a narrow sidebar otherwise gives that pane a horizontal scroll bar). */}
            <div aria-hidden className="absolute left-0 top-0 w-0 h-0 overflow-hidden invisible pointer-events-none">
                <div ref={measureRef} className={`${className} w-max`}>
                    {tabs.map(t => tab(t))}
                    <span className={`${TAB_CLASS} whitespace-nowrap`}>{moreLabel}</span>
                </div>
            </div>
        </div>
    );
}
