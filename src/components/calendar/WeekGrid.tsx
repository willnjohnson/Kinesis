import { Check, Folder, NotebookPen, Video as VideoIcon } from 'lucide-react';
import type { CalendarDayItem, CalendarEntry, CalendarTrack, CalendarTrackSummary } from '../../api';
import { calendarIcon } from '../../lib/calendar-icons';
import { InProgressIcon } from '../ui/MarkIcons';
import { trackColor, parseDay, addDays, niceDate, trackTime, PriorityMark, Marked, EntryTitle } from './shared';

/** The week: a row per track (labeled with its name and color dot), a column per day, each entry on its day as a chip. An
 *  undated track only gets a row when something of it was done this week. */
export function WeekGrid({ weekStart, today, tracks, items, fits, matchCount, flashDate, selectedId, onSelectTrack, onTrackMenu, onItem }: {
    /** While the search bar filters: whether an item fits. Cells holding one are marked in the accent color, and items
     *  that don't fit are dimmed, so what the filter found shows at a glance. */
    fits?: (item: CalendarDayItem) => boolean;
    /** How many of this week's items fit (said when none do). */
    matchCount: number;
    /** The day the search's Enter just jumped to: its items flash for a moment. */
    flashDate: string | null;
    weekStart: string;
    today: string;
    tracks: CalendarTrackSummary[];
    items: CalendarDayItem[];
    selectedId: number | null;
    onSelectTrack: (id: number) => void;
    /** A track's name was right-clicked: its menu (as in the panel). */
    onTrackMenu: (track: CalendarTrack, x: number, y: number) => void;
    onItem: (item: CalendarDayItem, x: number, y: number) => void;
}) {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    // Timed tracks first, earliest first (so the rows read like the day), then the ones for any time of day.
    const rows = tracks
        .filter(t => t.track.advanceMode !== 'completion' || items.some(i => i.trackId === t.track.id))
        .sort((a, b) => (a.track.timeStart ?? Infinity) - (b.track.timeStart ?? Infinity));
    const cell = 'border-l border-[#222] px-1.5 py-1.5 min-h-12';
    return (
        <div className="bg-[#121212] rounded-xl border border-[#272727] overflow-hidden">
            <div className="grid grid-cols-[minmax(7rem,10rem)_repeat(7,minmax(0,1fr))]">
                <div />
                {dates.map(date => {
                    const d = parseDay(date);
                    const isToday = date === today;
                    // Today looks like any other day, marked only by an accent line under its date (like the open tab's
                    // line in the title bar).
                    return (
                        <div key={date} className="border-l border-[#222] px-2 pt-2 pb-1.5 text-center">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                {d.toLocaleDateString(undefined, { weekday: 'short' })}
                            </div>
                            <div className={`text-lg font-bold leading-tight ${isToday ? 'text-white' : 'text-gray-300'}`}>{d.getDate()}</div>
                            <div className={`mx-auto mt-1 h-0.5 w-6 rounded-full ${isToday ? 'bg-[var(--k-accent)]' : 'bg-transparent'}`} />
                        </div>
                    );
                })}
                {rows.map(({ track }) => (
                    <div key={track.id} className="contents">
                        <button
                            onClick={() => onSelectTrack(track.id)}
                            onContextMenu={e => { e.preventDefault(); onTrackMenu(track, e.clientX, e.clientY); }}
                            className={`border-t border-[#222] flex items-center gap-2 px-3 py-1.5 text-left min-w-0 hover:bg-[#1a1a1a] transition-colors cursor-pointer ${selectedId === track.id ? 'bg-[#1a1a1a]' : ''}`}
                            title={track.name}
                        >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor(track.id) }} />
                            <span className="min-w-0">
                                <span className="block text-xs font-semibold text-gray-300 truncate"><Marked text={track.name} of="track" /></span>
                                {trackTime(track) && <span className="block text-[10px] text-gray-500 truncate">{trackTime(track)}</span>}
                            </span>
                        </button>
                        {dates.map(date => {
                            // A folder's items kept together (undated tracks list what was done in any order).
                            const here = items
                                .filter(i => i.trackId === track.id && i.date === date)
                                .sort((a, b) => (a.folderId ?? 0) - (b.folderId ?? 0));
                            const hit = fits !== undefined && here.some(fits);
                            return (
                            <div key={date} className={`border-t ${cell} space-y-1 transition-colors ${hit ? 'bg-[color-mix(in_srgb,var(--k-accent)_12%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--k-accent)_45%,transparent)]' : ''}`}>
                                {here.map((item, at) => (
                                    // The same chip as a video's tags in the sidebar (sidebar/VideoTagsPanel.tsx); which track
                                    // it's on is the row's label. A folder's items come together, under its name; an empty
                                    // folder shows as itself.
                                    <div key={`${item.entryId}|${item.videoId}|${item.cycle}|${item.kind}`} className={item.folderId !== null ? 'pl-1.5 border-l border-[#333]' : ''}>
                                    {item.folderId !== null && here[at - 1]?.folderId !== item.folderId && (
                                        <div className="flex items-center gap-1 -ml-1.5 pl-0.5 mb-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500 truncate" title={`Folder: ${item.folder}`}>
                                            <Folder className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{item.folder}</span>
                                        </div>
                                    )}
                                    {item.isFolder ? (
                                        <button
                                            onClick={e => onItem(item, e.clientX, e.clientY)}
                                            className="w-full flex items-center gap-1 rounded-md border border-dashed border-[#383838] px-2 py-1 text-left cursor-pointer hover:bg-[#1f1f1f]"
                                            title={`${item.title}: An empty folder (drag videos or tasks into it in the track's list)`}
                                        >
                                            <Folder className="w-3 h-3 shrink-0 text-gray-500" />
                                            <span className="text-[11px] truncate flex-1 text-gray-500">{item.title}</span>
                                        </button>
                                    ) : (
                                    <button
                                        onClick={e => onItem(item, e.clientX, e.clientY)}
                                        className={`w-full flex items-center gap-1 rounded-md border bg-[#222222] hover:bg-[#333333] px-2 py-1 text-left transition-all cursor-pointer ${item.overdue ? 'border-red-500/50' : 'border-[#383838]'} ${item.date === flashDate ? 'ring-2 ring-[var(--k-accent)]' : ''} ${fits && !fits(item) ? 'opacity-40' : ''}`}
                                        title={`${item.title}${item.done ? ' (done)' : [item.inProgress && 'in progress', item.overdue && 'overdue'].filter(Boolean).map(s => ` (${s})`).join('')}${item.description ? `\n\n${item.description}` : ''}`}
                                    >
                                        {/* Done: a check. In progress: a half-filled circle, in amber. Otherwise the item's own icon. */}
                                        {item.done ? <Check className="w-3 h-3 shrink-0 text-gray-500" />
                                            : item.inProgress ? <InProgressIcon className="w-3 h-3 shrink-0 text-amber-400" />
                                            : (() => { const Icon = item.videoId ? VideoIcon : item.noteId ? NotebookPen : calendarIcon(item.icon); return <Icon className="w-3 h-3 shrink-0 -translate-y-px text-[#aaaaaa]" />; })()}
                                        <span className={`text-[11px] truncate flex-1 ${item.done ? 'text-gray-500 line-through' : item.overdue ? 'text-red-400' : 'text-white'}`}><Marked text={item.title} of="item" /></span>
                                        {!item.done && <PriorityMark level={item.priority} className="w-3 h-3" />}
                                    </button>
                                    )}
                                    </div>
                                ))}
                            </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            {rows.length === 0 ? (
                <p className="border-t border-[#222] text-center text-sm text-gray-500 py-8">
                    {tracks.length === 0 ? 'Every track is hidden.' : 'Nothing scheduled this week.'}
                </p>
            ) : fits && matchCount === 0 && (
                <p className="border-t border-[#222] text-center text-xs text-gray-500 py-3">
                    Nothing this week matches. Press Enter in the search bar to jump to the next match.
                </p>
            )}
        </div>
    );
}

/** What's next on the tracks the week can't show: undated ones, and dated ones that have fallen behind. */
export function UpNext({ tracks, onSelectTrack, onOpenVideo, onMark }: {
    tracks: CalendarTrackSummary[];
    onSelectTrack: (id: number) => void;
    onOpenVideo: (videoId: string) => void;
    onMark: (summary: CalendarTrackSummary, entry: CalendarEntry) => void;
}) {
    const rows = tracks.filter(t => t.state.current !== null && (t.track.advanceMode === 'completion' || t.state.currentOverdue));
    if (rows.length === 0) return null;
    return (
        <div className="mt-6">
            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">Up next</h3>
            <div className="bg-[#121212] rounded-xl border border-[#272727] divide-y divide-[#222]">
                {rows.map(summary => {
                    const { track, state } = summary;
                    const entry = state.entries[state.current!];
                    return (
                        <div key={track.id} className="flex items-center gap-3 px-3 py-2">
                            <button onClick={() => onSelectTrack(track.id)} className="flex items-center gap-2 w-40 shrink-0 min-w-0 text-left cursor-pointer" title={track.name}>
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor(track.id) }} />
                                <span className="text-xs font-semibold text-gray-400 hover:text-white truncate transition-colors"><Marked text={track.name} of="track" /></span>
                            </button>
                            <EntryTitle entry={entry} onOpenVideo={onOpenVideo} className="text-sm text-gray-200 min-w-0 truncate" />
                            <PriorityMark level={entry.priority} />
                            {entry.inProgress && <span className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold shrink-0"><InProgressIcon className="w-3 h-3" /> In progress</span>}
                            {state.currentOverdue && state.currentDue && <span className="text-[11px] text-red-400 font-semibold shrink-0">Overdue since {niceDate(state.currentDue)}</span>}
                            {track.loopEntries && <span className="text-[11px] text-gray-500 shrink-0">Round {state.round + 1}</span>}
                            <button
                                onClick={() => onMark(summary, entry)}
                                className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#222] border border-[#383838] hover:bg-[#3f3f3f] text-white text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                                <Check className="w-3.5 h-3.5" /> Mark Done
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
