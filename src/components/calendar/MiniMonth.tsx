import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Video as VideoIcon } from 'lucide-react';
import { listCalendarDays, type CalendarDayItem } from '../../api';
import { FloatingCard } from '../FloatingCard';
import { calendarIcon } from '../../lib/calendar-icons';
import { trackColor, parseDay, isoDay, addDays, weekStartOf, PriorityMark, Marked } from './shared';

/** The whole month at a glance, at the top of the tracks panel: today circled in the accent color, the week the right side
 *  shows highlighted, and a dot under each day with something scheduled on a shown track (red when any of it is overdue).
 *  Clicking a day shows its week. It has its own ‹ › for months, and follows along when the week moves off its month. Weeks
 *  start on Monday, as the week view's do. */
export function MiniMonth({ weekStart, today, shownIds, fits, trackNames, version, onPickDay }: {
    weekStart: string;
    today: string;
    shownIds: Set<number>;
    /** Whether an item fits the search bar's filter: only those get dots and previews. */
    fits: (item: CalendarDayItem) => boolean;
    /** Each track's name, for the day preview. */
    trackNames: Map<number, string>;
    /** Changes whenever the page reloads, so the dots catch up with what was just marked done, added or moved. */
    version: number;
    onPickDay: (day: string) => void;
}) {
    // Resting the pointer on a day with something on it previews that day (after a moment, as the app's other hover
    // previews do: lib's usePreviewCard waits the same 350ms).
    const [preview, setPreview] = useState<{ day: string; rect: DOMRect } | null>(null);
    const hoverTimer = useRef(0);
    useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
    // The month on show, as its first day. It starts on the week's month (the month its Thursday falls in, so a week
    // that straddles two months belongs to the one with most of its days).
    const monthOfWeek = (start: string) => { const d = parseDay(addDays(start, 3)); return isoDay(new Date(d.getFullYear(), d.getMonth(), 1)); };
    const [month, setMonth] = useState(() => monthOfWeek(weekStart));
    const first = parseDay(month);
    // Six rows of weeks, from the Monday on or before the 1st, so every month fits.
    const gridStart = weekStartOf(month);
    const gridEnd = addDays(gridStart, 41);
    const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    // Follow along when the week view moves to a week this grid doesn't show.
    useEffect(() => {
        if (weekStart < gridStart || weekStart > gridEnd) setMonth(monthOfWeek(weekStart));
    }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

    const [items, setItems] = useState<CalendarDayItem[]>([]);
    useEffect(() => {
        let cancelled = false;
        listCalendarDays(gridStart, gridEnd).then(d => { if (!cancelled) setItems(d); }).catch(() => {});
        return () => { cancelled = true; };
    }, [gridStart, gridEnd, version]);
    // Per day: whether anything's scheduled, and whether any of it is overdue.
    const marks = useMemo(() => {
        const out = new Map<string, 'some' | 'overdue'>();
        for (const item of items) {
            if (item.kind !== 'scheduled' || !shownIds.has(item.trackId) || !fits(item)) continue;
            if (item.overdue) out.set(item.date, 'overdue');
            else if (!out.has(item.date)) out.set(item.date, 'some');
        }
        return out;
    }, [items, shownIds, fits]);

    // What's on each day, on the shown tracks: scheduled entries and (an undated track's) ones done that day, in order.
    const byDay = useMemo(() => {
        const out = new Map<string, CalendarDayItem[]>();
        for (const item of items) {
            if (!shownIds.has(item.trackId) || !fits(item)) continue;
            out.set(item.date, [...(out.get(item.date) ?? []), item]);
        }
        return out;
    }, [items, shownIds, fits]);

    const stepMonth = (by: number) => setMonth(isoDay(new Date(first.getFullYear(), first.getMonth() + by, 1)));
    const weekEnd = addDays(weekStart, 6);
    const PREVIEW_LIMIT = 8;
    const previewItems = preview ? byDay.get(preview.day) ?? [] : [];

    return (
        <div className="shrink-0 mb-4 bg-[#121212] rounded-xl border border-[#272727] p-3">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-sm font-bold text-white">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                <div className="flex items-center">
                    <button onClick={() => stepMonth(-1)} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Previous month"><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={() => stepMonth(1)} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Next month"><ChevronRight className="w-4 h-4" /></button>
                </div>
            </div>
            <div className="grid grid-cols-7 text-center">
                {cells.slice(0, 7).map(day => (
                    <span key={day} className="text-[10px] font-bold text-gray-500 pb-1">
                        {parseDay(day).toLocaleDateString(undefined, { weekday: 'narrow' })}
                    </span>
                ))}
                {cells.map(day => {
                    const d = parseDay(day);
                    const inMonth = d.getMonth() === first.getMonth();
                    const inWeek = day >= weekStart && day <= weekEnd;
                    const isToday = day === today;
                    const mark = marks.get(day);
                    // The shown week reads as one band across its row: rounded only at its ends.
                    const band = inWeek ? `bg-[#222222] ${day === weekStart ? 'rounded-l-full' : ''} ${day === weekEnd ? 'rounded-r-full' : ''}` : '';
                    return (
                        <div key={day} className={`flex justify-center py-0.5 ${band}`}>
                            <button
                                onClick={() => { window.clearTimeout(hoverTimer.current); setPreview(null); onPickDay(day); }}
                                onMouseEnter={e => {
                                    window.clearTimeout(hoverTimer.current);
                                    if (!byDay.has(day)) return;
                                    const el = e.currentTarget;
                                    hoverTimer.current = window.setTimeout(() => { if (el.isConnected) setPreview({ day, rect: el.getBoundingClientRect() }); }, 350);
                                }}
                                onMouseLeave={() => { window.clearTimeout(hoverTimer.current); setPreview(null); }}
                                // A day with things on it has the preview (which names the date); an empty one just its date.
                                title={byDay.has(day) ? undefined : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                className={`relative w-7 h-7 rounded-full text-xs tabular-nums transition-colors cursor-pointer ${
                                    isToday ? 'bg-[var(--k-accent)] text-white font-bold'
                                        : inMonth ? 'text-gray-200 hover:bg-[#333333]' : 'text-gray-600 hover:bg-[#333333]'
                                }`}
                            >
                                {d.getDate()}
                                {mark && !isToday && (
                                    <span className={`absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full ${mark === 'overdue' ? 'bg-red-500' : 'bg-gray-500'}`} />
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
            {/* The day preview: the same floating card as the app's other hover previews, opening to the right (over the
                week, away from the panel). Only looked at, never clicked, so it doesn't take the pointer. */}
            {preview && previewItems.length > 0 && (
                <FloatingCard anchor={preview.rect} side="right" className="w-72 px-3.5 py-3 text-left">
                    <div className="text-sm font-semibold text-white mb-2">
                        {parseDay(preview.day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <ul className="space-y-1.5">
                        {previewItems.slice(0, PREVIEW_LIMIT).map(item => {
                            const Icon = item.videoId ? VideoIcon : calendarIcon(item.icon);
                            return (
                                <li key={`${item.trackId}|${item.entryId}|${item.videoId}|${item.cycle}|${item.kind}`} className="flex items-start gap-2">
                                    <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor(item.trackId) }} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            {item.done ? <Check className="w-3.5 h-3.5 shrink-0 text-gray-500" /> : <Icon className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />}
                                            <span className={`text-[13px] truncate ${item.done ? 'text-gray-500 line-through' : item.overdue ? 'text-red-400' : 'text-gray-200'}`}><Marked text={item.title} of="item" /></span>
                                            {!item.done && <PriorityMark level={item.priority} className="w-3 h-3" />}
                                        </div>
                                        <div className="text-[11px] text-gray-500 truncate">
                                            {trackNames.get(item.trackId) ?? ''}
                                            {item.overdue ? ' · overdue' : item.kind === 'completed' ? ' · done that day' : ''}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {previewItems.length > PREVIEW_LIMIT && (
                        <p className="text-[11px] text-gray-500 mt-2">+{previewItems.length - PREVIEW_LIMIT} more</p>
                    )}
                </FloatingCard>
            )}
        </div>
    );
}
