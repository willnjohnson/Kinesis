import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { WdbsRoot } from '../api';

// The Drive pickers' shared parts (the Glossary's and the Notes section's): every Drive as an expandable list, and the
// dismissing every dropdown of theirs does.

/** A Drive by name, as the Glossary and Notes show it: its path without the colon ("FRENCH-CH1"). */
export const driveLabel = (path: string) => path.replace(/^:/, '');

/** Every Drive in the tree, each followed by the Drives beneath it. */
export const allDrives = (roots: WdbsRoot[]): WdbsRoot[] => roots.flatMap(r => [r, ...allDrives(r.children)]);

/** Closes a dropdown on a click outside `boxRef` or on Esc (just the dropdown, not a dialog behind it). */
export function useDismiss(open: boolean, close: () => void, boxRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open, close, boxRef]);
}

/** Every Drive as an expandable list: a Drive with sub-Drives has a chevron that shows them in place, indented
 *  beneath it. Picking a row calls `onPick`; `isOn` marks the picked ones (with a checkbox when `checkboxes`, else
 *  in the accent color). Opens with the Drives above each picked one expanded, so a pick is never hidden. */
export function DriveTreeList({ roots, isOn, onPick, checkboxes }: { roots: WdbsRoot[], isOn: (path: string) => boolean, onPick: (path: string) => void, checkboxes: boolean }) {
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const open = new Set<string>();
        for (const d of allDrives(roots)) {
            if (!isOn(d.path)) continue;
            for (let i = d.path.indexOf('-'); i !== -1; i = d.path.indexOf('-', i + 1)) open.add(d.path.slice(0, i));
        }
        return open;
    });
    const toggleExpanded = (path: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
    });

    const rows = (nodes: WdbsRoot[], depth: number): ReactNode[] => nodes.flatMap(r => {
        const on = isOn(r.path);
        const open = expanded.has(r.path);
        // Collapsed, a Drive says how many picks are hidden beneath it.
        const inside = open ? 0 : allDrives(r.children).filter(c => isOn(c.path)).length;
        const row = (
            <div key={r.path} className="flex items-center hover:bg-[#222222] transition-colors" style={{ paddingLeft: 4 + depth * 16 }}>
                {r.children.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => toggleExpanded(r.path)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} the Drives in ${r.segment}`}
                        className="p-1 shrink-0 text-gray-500 hover:text-white cursor-pointer"
                    >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                    </button>
                ) : <span className="w-[22px] shrink-0" />}
                <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onPick(r.path)}
                    title={r.alias ?? undefined}
                    className={`flex-1 min-w-0 flex items-center gap-3 pl-1 pr-4 py-2 text-left cursor-pointer ${!checkboxes && on ? 'text-[var(--k-accent)]' : 'text-gray-200'}`}
                >
                    {checkboxes && (
                        <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-[var(--k-accent)] border-[var(--k-accent)]' : 'border-[#555]'}`}>
                            {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </span>
                    )}
                    <span className="truncate">{r.segment}</span>
                    {inside > 0 && <span className="ml-auto shrink-0 text-[10px] text-gray-500">{inside} inside</span>}
                </button>
            </div>
        );
        return [row, ...(open ? rows(r.children, depth + 1) : [])];
    });

    return <>{rows(roots, 0)}</>;
}
