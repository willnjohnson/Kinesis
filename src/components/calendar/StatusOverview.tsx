import { useCallback, useEffect, useRef, useState } from 'react';
import { CALENDAR_CHANGED_EVENT, listCalendarDays, type CalendarDayItem, type CalendarTrackSummary } from '../../api';
import { addDays, niceDate } from './shared';

/** What the Calendar's status bar shows on its right, in turn. */
const VIEWS = ['today', 'next', 'due', 'tomorrow'] as const;
type View = typeof VIEWS[number];
/** How long each one shows, and how long it takes to fade out (and the next one in). */
const SHOW_MS = 6000;
const FADE_MS = 400;

/** Scheduled items that are real to-dos (an empty folder holds its day but isn't one). */
const toDos = (items: CalendarDayItem[], day: string) => items.filter(i => i.date === day && i.kind === 'scheduled' && !i.isFolder);

/**
 * The right end of the Calendar's status bar: a few overviews, taking turns. Each shows for a few seconds, then fades out
 * as the next fades in; with the pointer over it, the one showing stays, so it can be read.
 *   - Today: the date.
 *   - Next up: the soonest item not done across the tracks shown (the overdue first).
 *   - Due today: how many of today's items are still to do.
 *   - Tomorrow: how many items tomorrow holds.
 */
export function StatusOverview({ today, tracks }: { today: string; tracks: CalendarTrackSummary[] }) {
    const [index, setIndex] = useState(0);
    const [visible, setVisible] = useState(true);
    const [items, setItems] = useState<CalendarDayItem[]>([]);
    const hovered = useRef(false);
    const tomorrow = addDays(today, 1);

    const load = useCallback(() => {
        listCalendarDays(today, tomorrow).then(setItems).catch(() => setItems([]));
    }, [today, tomorrow]);
    useEffect(() => {
        load();
        window.addEventListener(CALENDAR_CHANGED_EVENT, load);
        return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, load);
    }, [load, tracks]);

    // Every few seconds (not while hovered): fade out, switch, fade back in.
    useEffect(() => {
        let swap = 0;
        const turn = window.setInterval(() => {
            if (hovered.current) return;
            setVisible(false);
            swap = window.setTimeout(() => {
                setIndex(i => (i + 1) % VIEWS.length);
                setVisible(true);
            }, FADE_MS);
        }, SHOW_MS);
        return () => { window.clearInterval(turn); window.clearTimeout(swap); };
    }, []);

    // Next up: each track's current item, the ones with a day first (the earliest, so an overdue one leads), then the
    // undated ones in the order the tracks are listed.
    const next = tracks
        .filter(t => t.state.current !== null && !t.state.entries[t.state.current].done)
        .map(t => ({ entry: t.state.entries[t.state.current!], due: t.state.currentDue }))
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))[0];
    const dueToday = toDos(items, today);
    const left = dueToday.filter(i => !i.done).length;
    const tomorrowCount = toDos(items, tomorrow).length;

    const view: View = VIEWS[index];
    const text = (() => {
        switch (view) {
            case 'today':
                return <>Today: <span className="text-white">{niceDate(today)}</span></>;
            case 'next':
                return <>Next up: <span className="text-white">{next ? next.entry.title : 'nothing left'}</span></>;
            case 'due':
                return dueToday.length === 0
                    ? <>Due today: <span className="text-white">nothing</span></>
                    : left === 0
                        ? <>Due today: <span className="text-white">all {dueToday.length} done</span></>
                        : <>Due today: <span className="text-white">{left}</span> of <span className="text-white">{dueToday.length}</span> left</>;
            case 'tomorrow':
                return tomorrowCount === 0
                    ? <>Tomorrow: <span className="text-white">nothing scheduled</span></>
                    : <>Tomorrow: <span className="text-white">{tomorrowCount}</span> {tomorrowCount === 1 ? 'item' : 'items'}</>;
        }
    })();

    return (
        <span
            onMouseEnter={() => { hovered.current = true; }}
            onMouseLeave={() => { hovered.current = false; }}
            // A long task name ends in "...", within the room the bar leaves it.
            className="ml-auto min-w-0 max-w-[45%] truncate transition-opacity ease-in-out"
            style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
            title={view === 'next' && next ? next.entry.title : undefined}
        >
            {text}
        </span>
    );
}
