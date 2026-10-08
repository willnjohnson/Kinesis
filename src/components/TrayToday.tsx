import { useCallback, useEffect, useState } from 'react';
import { Video as VideoIcon } from 'lucide-react';
import {
    calendarToday, listCalendarDays, listCalendarTracks, setCalendarCompletion,
    type CalendarDayItem, type CalendarEntry, type CalendarTrackSummary,
} from '../api';
import { calendarIcon, priorityOf } from '../lib/calendar-icons';
import { InProgressIcon } from './ui/MarkIcons';

/** One thing to check off: today's scheduled item, or a track's item that's past its day. */
interface Row {
    key: string;
    trackId: number;
    trackName: string;
    entry: Pick<CalendarEntry, 'id' | 'videoId'>;
    cycle: number;
    title: string;
    icon: string;
    videoId: string | null;
    priority: number;
    done: boolean;
    inProgress: boolean;
    /** "Due Mon, Sep 7" for an overdue one. */
    note?: string;
}

function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The tray popup's Today tab: what's on the Calendar for today, each with a checkbox, and below it anything that has
 * fallen behind (a track's item past its day and not done). Checking one off is the same as in the Calendar, and is
 * allowed in a read-only workspace. `reloadKey` changes each time the popup is shown, so it's always current.
 */
export function TrayToday({ reloadKey }: { reloadKey: number }) {
    const [today, setToday] = useState<Row[] | null>(null);
    const [overdue, setOverdue] = useState<Row[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const day = calendarToday();
        try {
            const [items, tracks] = await Promise.all([listCalendarDays(day, day), listCalendarTracks()]);
            const names = new Map(tracks.map(t => [t.track.id, t.track.name]));
            const fromItem = (i: CalendarDayItem): Row => ({
                key: `d|${i.trackId}|${i.entryId}|${i.videoId}|${i.cycle}`,
                trackId: i.trackId,
                trackName: names.get(i.trackId) ?? '',
                entry: { id: i.entryId, videoId: i.videoId },
                cycle: i.cycle,
                title: i.title,
                icon: i.icon,
                videoId: i.videoId,
                priority: i.priority,
                done: i.done,
                inProgress: i.inProgress,
            });
            const fromTrack = ({ track, state }: CalendarTrackSummary): Row => {
                const e = state.entries[state.current!];
                return {
                    key: `o|${track.id}|${e.id}|${e.videoId}|${state.cycle}`,
                    trackId: track.id,
                    trackName: track.name,
                    entry: e,
                    cycle: state.cycle,
                    title: e.title,
                    icon: e.icon,
                    videoId: e.videoId,
                    priority: e.priority,
                    done: e.done,
                    inProgress: e.inProgress,
                    note: state.currentDue ? `Due ${shortDate(state.currentDue)}` : undefined,
                };
            };
            setToday(items.filter(i => i.kind === 'scheduled' && !i.isFolder).map(fromItem));
            setOverdue(tracks.filter(t => t.state.currentOverdue && t.state.current !== null).map(fromTrack));
            setError(null);
        } catch (e) {
            setError(String(e));
            setToday([]);
        }
    }, []);
    useEffect(() => { void load(); }, [load, reloadKey]);

    const toggle = async (row: Row) => {
        setBusy(row.key);
        try {
            await setCalendarCompletion(row.trackId, row.entry, row.cycle, !row.done);
        } catch (e) {
            setError(String(e));
        }
        setBusy(null);
        await load();
    };

    const item = (row: Row) => {
        const Icon = row.inProgress && !row.done ? InProgressIcon : row.videoId ? VideoIcon : calendarIcon(row.icon);
        const priority = priorityOf(row.priority);
        return (
            <li key={row.key}>
                <label className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#1a1a1a] cursor-pointer ${busy === row.key ? 'opacity-50' : ''}`}>
                    <input type="checkbox" checked={row.done} disabled={busy === row.key} onChange={() => { void toggle(row); }} className="mt-0.5 cursor-pointer shrink-0" />
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${row.inProgress && !row.done ? 'text-amber-400' : 'text-[#888888]'}`} />
                    <span className="min-w-0 flex-1">
                        <span className={`block text-xs break-words ${row.done ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{row.title}</span>
                        <span className="block text-[10px] text-[#888888] truncate">
                            {row.trackName}
                            {row.inProgress && !row.done && <span className="text-amber-400"> · In progress</span>}
                            {row.note && <span className="text-red-400"> · {row.note}</span>}
                        </span>
                    </span>
                    {priority && !row.done && <priority.Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${priority.color}`} aria-label={`${priority.label} priority`} />}
                </label>
            </li>
        );
    };

    if (today === null) return <p className="text-xs text-[#888888] px-1">Loading...</p>;
    const left = today.filter(r => !r.done).length;

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="text-[11px] text-[#888888] px-1">
                {today.length === 0 ? 'Nothing scheduled today.' : left === 0 ? `All ${today.length} done for today.` : `${left} of ${today.length} left today`}
            </div>
            {error && <p className="text-xs text-red-400 break-words px-1">{error}</p>}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
                {today.length > 0 && <ul className="space-y-0.5">{today.map(item)}</ul>}
                {overdue.length > 0 && (
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-red-400/80 mb-1 px-1">Overdue</div>
                        <ul className="space-y-0.5">{overdue.map(item)}</ul>
                    </div>
                )}
            </div>
        </div>
    );
}
