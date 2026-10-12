import type { MouseEvent, ReactNode } from 'react';
import { FloatingCard } from './FloatingCard';
import { useHoverCard } from './VideoPreview';

/** A date and its time of day, in the reader's own format ("Oct 10, 2026, 5:12 PM"); the text as it is when it can't be read. */
export function fullDate(iso: string): string {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A note's or a workbook's two dates, as HoverDates' rows. */
export const editedAndCreated = (item: { createdAt: string; updatedAt: string }) => [
    { label: 'Last edited', value: fullDate(item.updatedAt) },
    { label: 'Created', value: fullDate(item.createdAt) },
];

/**
 * A row of a section's side panel (a note, a workbook, a log, a Calendar track, a Drive, a sequence) that says more
 * about itself on a card to its right, once the pointer has rested on it a moment (as the app's other hover previews
 * do): when it was last edited and when it was made, where there are such dates, and what else the row has no room
 * for. `rows` is what the card says, under the row's name; with none, no card opens. `children` draws the row, and puts
 * the handlers it's given on it. A button inside the row with a tooltip of its own calls `onMouseLeave` as the pointer
 * comes onto it, so the two don't show at once.
 */
export function HoverDates({ title, rows, children }: {
    title: string;
    rows: { label: string; value: string }[];
    children: (handlers: { onMouseEnter: (e: MouseEvent<HTMLElement>) => void; onMouseLeave: () => void }) => ReactNode;
}) {
    const hover = useHoverCard<true>(
        () => Promise.resolve(rows.length > 0 ? true : null),
        rect => <InfoCard anchor={rect} title={title} rows={rows} />,
    );
    return <>{children(hover.handlers)}{hover.card}</>;
}

/** The card itself: a name, and under it what there is to say, each with its label. To the right of `anchor` where
 *  there's room. As wide as what it says, from its usual width up to nearly twice that: a long name or value widens
 *  the card before it wraps. `children`: more under the rows. */
export function InfoCard({ anchor, title, rows, children }: { anchor: DOMRect; title: string; rows: { label: string; value: string }[]; children?: ReactNode }) {
    return (
        <FloatingCard anchor={anchor} side="right" className="w-max min-w-64 max-w-[min(30rem,calc(100vw-1rem))] px-3 py-2.5 text-left">
            <div className="text-sm font-bold text-white leading-tight line-clamp-2">{title}</div>
            {rows.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                    {rows.map(r => (
                        <div key={r.label} className="contents">
                            <dt className="text-gray-500">{r.label}</dt>
                            <dd className="min-w-0 text-gray-200 tabular-nums break-words line-clamp-3">{r.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
            {children}
        </FloatingCard>
    );
}
