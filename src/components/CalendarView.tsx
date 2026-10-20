import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openCalendarNote } from '../lib/notes';
import { Archive, ArchiveRestore, CalendarDays, Check, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileText, ListTodo, NotebookPen, Pencil, SignalHigh, Pin, PinOff, Play, Plus, RotateCcw, Trash2, Undo2, MoreVertical } from 'lucide-react';
import { addCalendarEntry, addCalendarNoteEntry, addCalendarWorkbook, deleteCalendarTrack, getVideoById, listCalendarDays, listCalendarTracks, removeCalendarEntry, CALENDAR_CHANGED_EVENT, setCalendarCompletion, setCalendarProgress, setCalendarEntryLayout, addCalendarFolder, startCalendarTrackOver, undoCalendarTrackStartOver, updateCalendarEntry, setCalendarTrackArchived, calendarToday, type CalendarDayItem, type CalendarEntry, type CalendarTrack, type CalendarTrackSummary, type Video, type DisplaySettings } from '../api';
import { getThemeCssVariables, resolveContentTheme, type Theme } from '../lib/themes';
import { useWorkspace } from '../hooks/useWorkspace';
import { useFlags } from '../hooks/useFlags';
import { normalizeText } from '../lib/utils';
import { PRIORITIES } from '../lib/calendar-icons';
import { filtersItems, highlightTerms, isFiltering, itemFits, parseCalendarFilter, trackFits } from '../lib/calendar-filter';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { BottomBar } from './BottomBar';
import { StatusOverview } from './calendar/StatusOverview';
import { DescriptionModal } from './calendar/DescriptionModal';
import type { NotificationContent } from './Notification';
import { trackColor, addDays, weekStartOf, weekLabel, statusLine, HighlightContext, Marked, MODE_LABEL, niceDate, repeatLabel, trackTime } from './calendar/shared';
import { fullDate, HoverDates } from './HoverDates';
import { MiniMonth } from './calendar/MiniMonth';
import { WeekGrid, UpNext } from './calendar/WeekGrid';
import { TrackDetail } from './calendar/TrackDetail';
import { ExportModal } from './calendar/ExportModal';
import { TaskModal } from './calendar/TaskModal';
import { TrackModal } from './calendar/TrackModal';
import { InProgressIcon } from './ui/MarkIcons';

// A per-viewer convenience, remembered in this browser (and fine to lose): which tracks are hidden. (Whether the panel is
// open is App's: its button sits beside the search bar.)
const HIDDEN_KEY = 'kinesis.calendar.hiddenTracks';
const SHOW_MONTH_KEY = 'kinesis.calendar.showMonth';
function readStored<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}
function writeStored(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: just not remembered */ }
}

// ── Dates, as local days ("2026-09-07"), never midnight UTC (which can land on the day before) ──

/**
 * The Calendar (see src-tauri/src/db/calendar.rs for the model): tracks in a panel on the left, like the Library's Drive tree,
 * and the week on the right. A dated track's entries sit on their scheduled days, colored by track; an undated one's sit on
 * the days they were done, and what's up next for it is in the strip under the week. Clicking a track in the panel opens
 * its entries there; clicking an entry on a day offers Mark Done and Open Video.
 */
export function CalendarView({ focusTrack, focusDate, pinnedIds, onSetPin, searchQuery, onVideoSelect, panelOpen, onOpenPanel, onNotify, displaySettings, customThemes }: {
    /** A track to open in the panel (a sidebar track chip's name); a new `at` asks again. */
    focusTrack?: { id: number; at: number } | null;
    /** A day to show (the pin menu's "due today" or "to do tomorrow"): its week opens and its items flash; a new `at` asks again. */
    focusDate?: { date: string; at: number } | null;
    /** The pinned videos (the title bar's pin menu), so a video item's menu offers Pin or Unpin. */
    pinnedIds: Set<string>;
    onSetPin: (videoId: string, pinned: boolean) => void;
    searchQuery: string;
    onVideoSelect: (video: Video) => void;
    /** Whether the tracks panel shows (toggled by App's button beside the search bar, like the Library's Drive panel). */
    panelOpen: boolean;
    /** Opens the panel: picking a track on the week shows its details there. */
    onOpenPanel: () => void;
    /** Shows a toast (App's notification), e.g. where an export was saved. */
    onNotify?: (n: NotificationContent) => void;
    displaySettings?: DisplaySettings | null;
    customThemes?: Theme[];
}) {
    const contentTheme = useMemo(
        () => resolveContentTheme(displaySettings, customThemes ?? []),
        [displaySettings, customThemes],
    );
    const contentThemeStyle = useMemo(
        () => displaySettings?.contentThemeCalendarEnabled
            ? ({
                ...getThemeCssVariables(contentTheme, displaySettings.blockquoteAccentEnabled ? displaySettings.blockquoteAccentColor : null),
                colorScheme: contentTheme.scheme,
                backgroundColor: 'var(--k-bg)',
                color: 'var(--k-text-white)',
            } as React.CSSProperties)
            : undefined,
        [displaySettings, contentTheme],
    );
    const { labels } = useWorkspace();
    const { flags } = useFlags();
    const canEdit = !flags.workspaceReadOnly;
    const today = calendarToday();
    const [tracks, setTracks] = useState<CalendarTrackSummary[]>([]);
    const [days, setDays] = useState<CalendarDayItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [weekStart, setWeekStart] = useState(() => weekStartOf(calendarToday()));
    const [showArchived, setShowArchived] = useState(false);
    // The small month calendar over the track list: off leaves the panel to the tracks. Remembered in this browser.
    const [showMonth, setShowMonthState] = useState(() => readStored<boolean>(SHOW_MONTH_KEY, true));
    const setShowMonth = (on: boolean) => {
        setShowMonthState(on);
        writeStored(SHOW_MONTH_KEY, on);
    };
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [hidden, setHidden] = useState<Set<number>>(() => new Set(readStored<number[]>(HIDDEN_KEY, [])));
    const [editing, setEditing] = useState<CalendarTrack | 'new' | null>(null);
    const [toDelete, setToDelete] = useState<CalendarTrack | null>(null);
    // An item waiting on "are you sure?" before it comes out of its track (with Confirm Before Deleting on, as elsewhere).
    const [entryToRemove, setEntryToRemove] = useState<CalendarEntry | null>(null);
    // The task window, for a new task on a track (no entry) or for editing one.
    const [taskEditor, setTaskEditor] = useState<{ trackId: number; trackName: string; entry: CalendarEntry | null; folder?: boolean } | null>(null);
    // A track waiting on "are you sure?" before it starts over.
    const [toStartOver, setToStartOver] = useState<CalendarTrack | null>(null);
    // The Export to Calendar window, and the tracks it starts with ticked (the one it was opened from).
    const [exportFor, setExportFor] = useState<Set<number> | null>(null);
    // A track's right-click menu (in the panel or on the week).
    const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; track: CalendarTrack } | null>(null);
    const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: CalendarDayItem } | null>(null);
    // An item's description, opened from its menu to read.
    const [reading, setReading] = useState<CalendarDayItem | null>(null);

    // Goes up on every load, so the mini month (which fetches its own days) knows something may have changed.
    const [version, setVersion] = useState(0);
    const load = useCallback(async () => {
        try {
            const [t, d] = await Promise.all([listCalendarTracks(showArchived), listCalendarDays(weekStart, addDays(weekStart, 6))]);
            setTracks(t);
            setDays(d);
            setVersion(v => v + 1);
            setError(null);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [showArchived, weekStart]);
    useEffect(() => { void load(); }, [load]);
    // Something checked off elsewhere (the sidebar's track chips, the tray popup's Today tab) shows here at once.
    useEffect(() => {
        const onChange = () => { void load(); };
        window.addEventListener(CALENDAR_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, onChange);
    }, [load]);
    // What's up depends on today's date, so look again when the window comes back after a while (past midnight, say).
    useEffect(() => {
        const onFocus = () => { void load(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [load]);

    // The action reports its own failure in the page's error line, then everything reloads either way.
    const act = (fn: () => Promise<unknown>) => async () => {
        try {
            await fn();
        } catch (e) {
            setError(String(e));
        }
        await load();
    };

    // Start over, and its undo: a toast offers it at once, and the track's menu keeps offering it (Undo Start Over) until
    // something's marked done in the new run (see db/calendar.rs's undo_calendar_track_start_over).
    const undoStartOver = (track: CalendarTrack) => {
        void act(async () => {
            await undoCalendarTrackStartOver(track.id);
            onNotify?.({ message: `"${track.name}" is back where it was.`, type: 'success' });
        })();
    };
    const startOver = (track: CalendarTrack) => {
        void act(async () => {
            await startCalendarTrackOver(track.id);
            onNotify?.({ message: `"${track.name}" started over.`, type: 'success', action: { label: 'Undo', onClick: () => undoStartOver(track) } });
        })();
    };

    const toggleHidden = (id: number) => setHidden(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        writeStored(HIDDEN_KEY, [...next]);
        return next;
    });
    const selectTrack = (id: number | null) => {
        setSelectedId(id);
        if (id !== null && !panelOpen) onOpenPanel();
    };
    // A track's name clicked on the week: opens it in the panel, or, clicked again while it's open there, goes back to
    // the list of every track. (The menus' Show Track and a sidebar chip only ever open it.)
    const toggleTrack = (id: number) => {
        if (selectedId === id && panelOpen) setSelectedId(null);
        else selectTrack(id);
    };
    // Asked from outside (a sidebar track chip): that track, open in the panel.
    useEffect(() => {
        if (focusTrack) selectTrack(focusTrack.id);
    }, [focusTrack?.at]); // eslint-disable-line react-hooks/exhaustive-deps

    const openVideo = async (videoId: string) => {
        const video = await getVideoById(videoId).catch(() => null);
        if (video) onVideoSelect(video);
        else setError("That video isn't in the library any more.");
    };

    // The search bar as a filter (lib/calendar-filter.ts): plain words or one facet, over items as well as tracks.
    const filter = useMemo(() => parseCalendarFilter(searchQuery), [searchQuery]);
    const filtering = isFiltering(filter);
    // Anything beyond the track/Drive parts looks at the items themselves.
    const byItems = filtersItems(filter);
    // What's looked for, marked wherever a name shows it (Marked).
    const highlight = useMemo(() => highlightTerms(filter), [filter]);
    const trackById = useMemo(() => new Map(tracks.map(t => [t.track.id, t.track])), [tracks]);
    /** Whether a day's item fits the filter (everything does, with nothing typed). */
    const itemMatches = useCallback((item: CalendarDayItem) => {
        const track = trackById.get(item.trackId);
        return !filtering || (track !== undefined && itemFits(filter, item, track));
    }, [filtering, filter, trackById]);
    /** Whether a track fits: by its own name or Drive, or by any of its items (its current run's; the one up counts as
     *  overdue when it is). A track's name typed finds the track even with nothing in it. */
    const trackMatches = ({ track, state }: CalendarTrackSummary) => {
        if (!filtering) return true;
        if (!trackFits(filter, track)) return false;
        if (!byItems) return true;
        const current = state.current !== null ? state.entries[state.current] : null;
        if (state.entries.some(e => itemFits(filter, { ...e, overdue: e === current && state.currentOverdue }, track))) return true;
        const name = normalizeText(track.name);
        return filter.facet === null && filter.words.every(w => name.includes(w));
    };
    const listed = tracks.filter(trackMatches);
    const selected = tracks.find(t => t.track.id === selectedId) ?? null;
    // Tracks that aren't archived or hidden. The week keeps all of them while filtering, so it doesn't jump about as
    // the filter's typed: the cells that fit are marked instead.
    const visible = tracks.filter(t => !t.track.archived && !hidden.has(t.track.id));
    const visibleIds = new Set(visible.map(t => t.track.id));
    // Of those, the ones that fit the filter (for Up next, the mini month and the counts).
    const shown = visible.filter(trackMatches);
    const shownIds = new Set(shown.map(t => t.track.id));
    // This week's items on the shown tracks that fit the filter.
    const weekItems = days.filter(d => shownIds.has(d.trackId) && itemMatches(d));
    // For the bottom bar: how many tracks are on the week out of all the active ones, what this week holds, and what's overdue.
    const activeCount = tracks.filter(t => !t.track.archived).length;
    const weekScheduled = weekItems.filter(d => d.kind === 'scheduled' && !d.isFolder);
    const weekDone = weekScheduled.filter(d => d.done).length;
    const overdueCount = shown.filter(t => t.state.currentOverdue).length;

    // Enter in the search bar jumps the week to the next item that fits (Shift+Enter, the one before), looking up to a year
    // either way from the last one jumped to (from today, after the filter changes). The day jumped to flashes on the week.
    const jumpFrom = useRef<string | null>(null);
    const [flashDate, setFlashDate] = useState<string | null>(null);
    useEffect(() => { jumpFrom.current = null; }, [searchQuery]);
    const jumpRef = useRef<(back: boolean) => void>(() => {});
    jumpRef.current = async (back: boolean) => {
        if (!filtering) return;
        const from = jumpFrom.current ?? today;
        // The first jump forward counts today; after that, strictly past the last one.
        const [rangeFrom, rangeTo] = back
            ? [addDays(from, -365), addDays(from, -1)]
            : [jumpFrom.current ? addDays(from, 1) : from, addDays(from, 365)];
        try {
            const found = (await listCalendarDays(rangeFrom, rangeTo)).filter(d => shownIds.has(d.trackId) && itemMatches(d));
            const next = back ? found[found.length - 1] : found[0];
            if (!next) {
                onNotify?.({ message: `No ${back ? 'earlier' : 'later'} matches within a year.`, type: 'info' });
                return;
            }
            jumpFrom.current = next.date;
            setWeekStart(weekStartOf(next.date));
            setFlashDate(next.date);
            window.setTimeout(() => setFlashDate(d => (d === next.date ? null : d)), 1600);
        } catch (e) {
            setError(String(e));
        }
    };
    useEffect(() => {
        if (!focusDate) return;
        const { date } = focusDate;
        setWeekStart(weekStartOf(date));
        setFlashDate(date);
        const t = window.setTimeout(() => setFlashDate(d => (d === date ? null : d)), 1600);
        return () => window.clearTimeout(t);
    }, [focusDate?.at]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return;
            if (!(e.target instanceof HTMLElement) || !e.target.hasAttribute('data-k-search')) return;
            void jumpRef.current(e.shiftKey);
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, []);

    // A track's right-click menu, the same in the panel and on the week: its details, editing, Start over, Export (a dated
    // track only: an undated one has no days to put on another calendar), hiding it, archiving, deleting.
    const openTrackMenu = (track: CalendarTrack, x: number, y: number) => setTrackMenu({ x, y, track });
    const trackMenuItems = (track: CalendarTrack): ContextMenuItem[] => {
        const dated = track.advanceMode !== 'completion';
        const isHidden = hidden.has(track.id);
        const canUndo = tracks.find(t => t.track.id === track.id)?.state.canUndoStartOver ?? false;
        return [
            { label: 'Show Details', icon: ListTodo, onClick: () => selectTrack(track.id) },
            ...(canEdit ? [
                { label: 'Edit Track', icon: Pencil, onClick: () => setEditing(track) },
                { label: 'Start Over', icon: RotateCcw, onClick: () => setToStartOver(track) },
                // Kept until something's marked in the new run, so it's still there after the toast's Undo is gone.
                ...(canUndo ? [{ label: 'Undo Start Over', icon: Undo2, onClick: () => undoStartOver(track) }] : []),
            ] : []),
            ...(dated && !track.archived ? [{ label: 'Export to Calendar (.ics)', icon: Download, onClick: () => setExportFor(new Set([track.id])), divider: true }] : []),
            ...(!track.archived ? [{
                label: isHidden ? 'Show on Calendar' : 'Hide from Calendar', icon: isHidden ? Eye : EyeOff, onClick: () => toggleHidden(track.id),
                divider: !dated,
            }] : []),
            ...(canEdit ? [
                { label: track.archived ? 'Unarchive' : 'Archive', icon: track.archived ? ArchiveRestore : Archive, onClick: () => { void act(() => setCalendarTrackArchived(track.id, !track.archived))(); } },
                { label: 'Delete Track', icon: Trash2, danger: true, divider: true, onClick: () => setToDelete(track) },
            ] : []),
        ];
    };

    // The row an entry's edits are written to. A video on a track that follows its Drive's sequence has none until it's
    // needed: adding it there makes (or finds) it.
    const rowIdOf = async (trackId: number, entry: CalendarEntry) =>
        entry.id > 0 || !entry.videoId ? entry.id : await addCalendarEntry(trackId, { videoId: entry.videoId });
    const setPriority = (trackId: number, entry: CalendarEntry, priority: number) => act(async () => {
        const id = await rowIdOf(trackId, entry);
        // Everything an entry has, so only the priority changes.
        await updateCalendarEntry(id, { label: entry.label, targetDate: entry.targetDate, icon: entry.icon, description: entry.description, priority });
    })();

    const itemMenuItems = (item: CalendarDayItem): ContextMenuItem[] => {
        const summary = tracks.find(t => t.track.id === item.trackId);
        // An empty folder has nothing to mark.
        if (item.isFolder) return [];
        // The entry itself (the week's item is that entry on one day), for editing it.
        const entry = summary?.state.entries.find(e => (item.entryId > 0 ? e.id === item.entryId : e.videoId !== null && e.videoId === item.videoId));
        const kind = item.noteId ? 'Note' : item.videoId ? 'Video' : 'Task';
        return [
            // Marking done stays open in a read-only workspace: it's progress, not an edit to the track.
            item.done
                ? { label: 'Mark Not Done', icon: Undo2, onClick: () => { void act(() => setCalendarCompletion(item.trackId, { id: item.entryId, videoId: item.videoId }, item.cycle, false))(); } }
                : { label: 'Mark Done', icon: Check, onClick: () => { void act(() => setCalendarCompletion(item.trackId, { id: item.entryId, videoId: item.videoId }, item.cycle, true))(); } },
            // In progress: a marker only (started, not finished), the reader's own like Done. Not offered once done.
            ...(!item.done ? [{
                label: item.inProgress ? 'Not In Progress' : 'Mark In Progress',
                icon: InProgressIcon,
                onClick: () => { void act(() => setCalendarProgress(item.trackId, { id: item.entryId, videoId: item.videoId }, item.cycle, !item.inProgress))(); },
            }] : []),
            ...(item.videoId ? [
                { label: 'Open Video', icon: Play, onClick: () => { void openVideo(item.videoId!); } },
                // Pins are the reader's own too, so this stays in a read-only workspace.
                pinnedIds.has(item.videoId)
                    ? { label: 'Unpin', icon: PinOff, onClick: () => onSetPin(item.videoId!, false) }
                    : { label: 'Pin', icon: Pin, onClick: () => onSetPin(item.videoId!, true) },
            ] : []),
            ...(item.noteId ? [{ label: 'Open Note', icon: NotebookPen, onClick: () => openCalendarNote(item.noteId!, item.workbookId) }] : []),
            // Its priority, picked from a second level. Editing the track's own entries, so not in a read-only workspace.
            ...(canEdit && entry ? [{
                label: 'Change Priority',
                icon: SignalHigh,
                divider: true,
                onClick: () => {},
                submenu: [
                    { label: 'None', checked: entry.priority === 0, onClick: () => { void setPriority(item.trackId, entry, 0); } },
                    ...PRIORITIES.map(p => ({
                        label: p.label,
                        icon: ({ className }: { className?: string }) => <p.Icon className={`${className ?? ''} ${p.color}`} />,
                        checked: entry.priority === p.level,
                        onClick: () => { void setPriority(item.trackId, entry, p.level); },
                    })),
                ],
            }] : []),
            // A task's (or video's) description, to read with its links working.
            ...(item.description.trim() ? [{ label: 'Open Description', icon: FileText, divider: !(canEdit && entry), onClick: () => setReading(item) }] : []),
            // The same window the track's panel opens from an entry's pencil.
            ...(canEdit && entry && summary ? [{
                label: `Edit ${kind}`,
                icon: Pencil,
                onClick: () => setTaskEditor({ trackId: item.trackId, trackName: summary.track.name, entry }),
            }] : []),
        ];
    };

    return (
        <HighlightContext.Provider value={highlight}>
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400 flex gap-6 h-full">
            {panelOpen && (
                <div className="w-80 min-w-48 shrink h-full flex flex-col">
                    <div className="shrink-0 flex items-center justify-between min-h-9 mb-4 px-1">
                        <h2 className="text-xl font-bold text-white">Tracks</h2>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 cursor-pointer select-none whitespace-nowrap" title="The small month calendar over the track list. Off, the panel is all tracks.">
                                <input type="checkbox" checked={showMonth} onChange={e => setShowMonth(e.target.checked)} className="cursor-pointer" />
                                Show Calendar
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 cursor-pointer select-none">
                                <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="cursor-pointer" />
                                Archived
                            </label>
                        </div>
                    </div>
                    {showMonth && <MiniMonth
                        weekStart={weekStart}
                        today={today}
                        shownIds={shownIds}
                        fits={itemMatches}
                        trackNames={new Map(tracks.map(t => [t.track.id, t.track.name]))}
                        version={version}
                        onPickDay={day => setWeekStart(weekStartOf(day))}
                    />}
                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                        {selected ? (
                            <TrackDetail
                                summary={selected}
                                canEdit={canEdit}
                                fits={byItems ? (entry, overdue) => itemFits(filter, { ...entry, overdue }, selected.track) : undefined}
                                onBack={() => setSelectedId(null)}
                                onOpenVideo={openVideo}
                                onMark={(entry, done) => { void act(() => setCalendarCompletion(selected.track.id, entry, selected.state.cycle, done))(); }}
                                onProgress={(entry, on) => { void act(() => setCalendarProgress(selected.track.id, entry, selected.state.cycle, on))(); }}
                                onRemove={entry => {
                                    // There's no undo (it takes what was marked done with it), so it asks first, unless the
                                    // workspace has Confirm Before Deleting off, as the Glossary and Attachments do.
                                    if (flags.confirmBeforeDeleting) setEntryToRemove(entry);
                                    else void act(() => removeCalendarEntry(entry.id))();
                                }}
                                onAddVideo={videoId => { void act(() => addCalendarEntry(selected.track.id, { videoId }))(); }}
                                onAddNote={flags.viewVisible.notes ? noteId => { void act(() => addCalendarNoteEntry(selected.track.id, noteId))(); } : undefined}
                                onAddWorkbook={flags.viewVisible.notes ? workbookId => { void act(() => addCalendarWorkbook(selected.track.id, workbookId))(); } : undefined}
                                onTask={entry => setTaskEditor({ trackId: selected.track.id, trackName: selected.track.name, entry })}
                                onNewFolder={() => setTaskEditor({ trackId: selected.track.id, trackName: selected.track.name, entry: null, folder: true })}
                                onStartOver={() => setToStartOver(selected.track)}
                                onUndoStartOver={() => undoStartOver(selected.track)}
                                onLayout={layout => { void act(() => setCalendarEntryLayout(selected.track.id, layout))(); }}
                                onEdit={() => setEditing(selected.track)}
                                onArchive={() => { void act(() => setCalendarTrackArchived(selected.track.id, !selected.track.archived))(); }}
                                onDelete={() => setToDelete(selected.track)}
                            />
                        ) : listed.length === 0 ? (
                            <div className="min-h-full text-center text-gray-500 py-12 px-4 bg-[#121212] rounded-xl border border-[#272727]">
                                <p className="text-sm">
                                    {tracks.length === 0
                                        ? 'A track is a list of videos or tasks to work through: One after another, on a weekly schedule like a class, or as a repeating rotation.'
                                        : 'No tracks match your search.'}
                                </p>
                            </div>
                        ) : (
                            <div className="min-h-full bg-[#121212] rounded-xl border border-[#272727] p-2 space-y-0.5">
                                {listed.map(summary => {
                                    const { track } = summary;
                                    const status = statusLine(summary);
                                    const isHidden = hidden.has(track.id);
                                    const time = trackTime(track);
                                    const dated = track.advanceMode !== 'completion';
                                    return (
                                        // Resting the pointer on it says what the row has no room for (its name and status
                                        // in full, how it runs, where it's at, when it was made), on a card to its right.
                                        <HoverDates
                                            key={track.id}
                                            title={track.name}
                                            rows={[
                                                { label: 'Status', value: status.text },
                                                { label: 'Kind', value: MODE_LABEL[track.advanceMode] },
                                                ...(dated ? [{ label: 'Schedule', value: `${repeatLabel(track.repeat, track.weekdays)}${time ? `, ${time}` : ''}` }] : []),
                                                ...(summary.state.total > 0 ? [{ label: 'Progress', value: `${summary.state.done} of ${summary.state.total} done` }] : []),
                                                ...(track.drive ? [{ label: labels.aliasDriveName, value: track.drive }] : []),
                                                ...(dated ? [{ label: 'Starts', value: niceDate(track.startDate) }] : []),
                                                { label: 'Created', value: fullDate(track.createdAt) },
                                            ]}
                                        >{hover => (
                                        <div
                                            {...hover}
                                            className={`group flex items-start gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-[#272727] transition-colors ${track.archived ? 'opacity-60' : ''}`}
                                            onClick={() => selectTrack(track.id)}
                                            onContextMenu={e => { e.preventDefault(); openTrackMenu(track, e.clientX, e.clientY); }}
                                        >
                                            <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: trackColor(track.id), opacity: isHidden ? 0.35 : 1 }} />
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-semibold truncate ${isHidden ? 'text-gray-500' : 'text-gray-200'}`}><Marked text={track.name} of="track" /></div>
                                                <div className={`text-[11px] truncate ${status.tone === 'overdue' ? 'text-red-400' : status.tone === 'done' ? 'text-green-400' : 'text-gray-500'}`}>{status.text}</div>
                                            </div>
                                            {!track.archived && (
                                                <button
                                                    onMouseEnter={hover.onMouseLeave}
                                                    onClick={e => { e.stopPropagation(); toggleHidden(track.id); }}
                                                    className={`p-1 rounded text-gray-500 hover:text-white transition-all cursor-pointer ${isHidden ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                                                    title={isHidden ? 'Show on the calendar' : 'Hide from the calendar'}
                                                >
                                                    {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                            )}
                                            <button
                                                onMouseEnter={hover.onMouseLeave}
                                                onClick={e => { e.stopPropagation(); openTrackMenu(track, e.clientX, e.clientY); }}
                                                className="p-1 rounded text-gray-500 hover:text-white transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                title="More actions"
                                            >
                                                <MoreVertical className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        )}</HoverDates>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {canEdit && (
                        <div className="shrink-0 mt-3 mb-2">
                            <button
                                onClick={() => setEditing('new')}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-bold transition-all cursor-pointer bg-[#121212] border-[#404040] text-gray-400 hover:text-white hover:border-[#505050]"
                            >
                                <Plus className="w-3.5 h-3.5" /> New Track
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div
                className={`flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden custom-scrollbar pb-6 ${contentThemeStyle ? 'k-content-theme' : ''}`}
                style={contentThemeStyle}
            >
                <div className="sticky top-0 z-10 bg-[#0f0f0f] flex items-center gap-3 min-h-9 mb-4 px-1">
                    <h2 className="text-xl font-bold text-white">{labels.aliasCalendar}</h2>
                    <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => setWeekStart(w => addDays(w, -7))} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Previous week"><ChevronLeft className="w-4 h-4" /></button>
                        <span className="text-sm font-semibold text-gray-200 tabular-nums min-w-44 text-center">{weekLabel(weekStart)}</span>
                        <button onClick={() => setWeekStart(w => addDays(w, 7))} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Next week"><ChevronRight className="w-4 h-4" /></button>
                        {/* The same shape and size as the Glossary's Add Term button (icon, padding, corners, text), in the
                            neutral grey the app gives navigation and view controls (the Glossary's view dropdown): red is kept
                            for a page's main "create" action. */}
                        <button
                            onClick={() => setWeekStart(weekStartOf(today))}
                            disabled={weekStart === weekStartOf(today)}
                            title="Go to this week"
                            className="ml-1 flex items-center gap-1.5 px-2 py-1.5 bg-[#272727] hover:bg-[#3f3f3f] text-white rounded-md transition-colors text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:bg-[#272727]"
                        >
                            <CalendarDays className="w-4 h-4" /> Today
                        </button>
                    </div>
                </div>

                {error && <div className="mb-3 text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

                {!loading && tracks.length === 0 ? (
                    <div className="text-center text-gray-500 py-24 bg-[#121212] rounded-xl border border-[#272727]">
                        <p className="text-xl font-bold text-white mb-2">Plan what to watch</p>
                        <p className="text-sm max-w-md mx-auto mb-4">
                            {/* Read-only: there's no New Track button, so it doesn't ask for one. */}
                            {canEdit
                                ? 'Make a track to work through videos one after another, on a weekly schedule like a class, or as a repeating rotation.'
                                : 'No tracks in this workspace yet. It is read-only, so tracks can\'t be added here.'}
                        </p>
                        {canEdit && (
                            <button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md transition-colors text-xs font-semibold cursor-pointer">
                                <Plus className="w-4 h-4" /> New Track
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <WeekGrid
                            weekStart={weekStart}
                            today={today}
                            tracks={visible}
                            items={days.filter(d => visibleIds.has(d.trackId))}
                            fits={filtering ? itemMatches : undefined}
                            matchCount={weekItems.length}
                            flashDate={flashDate}
                            selectedId={selectedId}
                            onSelectTrack={toggleTrack}
                            onTrackMenu={openTrackMenu}
                            onItem={(item, x, y) => setItemMenu({ x, y, item })}
                        />
                        <UpNext
                            // Filtering: only tracks whose next item fits.
                            tracks={!filtering ? shown : shown.filter(({ track, state }) => {
                                const entry = state.current !== null ? state.entries[state.current] : null;
                                return entry !== null && itemFits(filter, { ...entry, overdue: state.currentOverdue }, track);
                            })}
                            onSelectTrack={toggleTrack} onOpenVideo={openVideo}
                            onMark={(summary, entry) => { void act(() => setCalendarCompletion(summary.track.id, entry, summary.state.cycle, true))(); }} />
                    </>
                )}
            </div>

            {/* The status bar every section has (BottomBar.tsx), in the same style as the Library's: white numbers, muted words. */}
            <BottomBar>
                <div className="flex items-center gap-6 flex-1 min-w-0 text-[11px] font-semibold text-gray-400">
                    {/* While the tracks panel is open, this part is as wide as it (w-80, from the same left edge), so the
                        week's counts end where the panel does: they're about its tracks. */}
                    <div className={`flex items-center gap-6 min-w-0 ${panelOpen ? 'w-80 shrink-0' : ''}`}>
                        <span className="shrink-0 whitespace-nowrap">
                            {shown.length < activeCount
                                ? <><span className="text-white">{shown.length}</span> of <span className="text-white">{activeCount}</span> tracks</>
                                : <><span className="text-white">{activeCount}</span> {activeCount === 1 ? 'track' : 'tracks'}</>}
                        </span>
                        {weekScheduled.length > 0 && (
                            <span className={`flex items-center gap-4 min-w-0 whitespace-nowrap ${panelOpen ? 'ml-auto' : ''}`}>
                                <span><span className="text-white">{weekScheduled.length}</span> {filtering ? 'matching' : weekScheduled.length === 1 ? 'task' : 'tasks'} this week</span>
                                <span><span className="text-white">{weekDone}</span> completed</span>
                            </span>
                        )}
                    </div>
                    {overdueCount > 0 && (
                        <span className="shrink-0 whitespace-nowrap text-red-400">
                            {overdueCount} overdue
                        </span>
                    )}
                    {/* A few overviews (today, next up, due today, tomorrow), taking turns with a fade. */}
                    <StatusOverview today={today} tracks={shown} />
                </div>
            </BottomBar>

            {reading && (
                <DescriptionModal
                    title={reading.title}
                    trackName={tracks.find(t => t.track.id === reading.trackId)?.track.name ?? ''}
                    description={reading.description}
                    onClose={() => setReading(null)}
                />
            )}

            {itemMenu && itemMenuItems(itemMenu.item).length > 0 && <ContextMenu x={itemMenu.x} y={itemMenu.y} items={itemMenuItems(itemMenu.item)} onClose={() => setItemMenu(null)} />}

            {editing && (
                <TrackModal
                    track={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={async (id) => {
                        setEditing(null);
                        if (id !== null) selectTrack(id);
                        await load();
                    }}
                />
            )}

            {taskEditor && (
                <TaskModal
                    entry={taskEditor.entry}
                    folder={taskEditor.folder}
                    trackName={taskEditor.trackName}
                    onClose={() => setTaskEditor(null)}
                    onSave={async task => {
                        // Errors are shown in the window (TaskModal catches them), which stays open to fix them.
                        if (taskEditor.entry) {
                            // Everything the window edits (name, icon, description, priority), so none is dropped back to its
                            // default; the target date isn't in the window, so it keeps the one it has.
                            await updateCalendarEntry(await rowIdOf(taskEditor.trackId, taskEditor.entry), { ...task, targetDate: taskEditor.entry.targetDate });
                        } else if (taskEditor.folder) {
                            await addCalendarFolder(taskEditor.trackId, task.label);
                        } else {
                            await addCalendarEntry(taskEditor.trackId, task);
                        }
                        setTaskEditor(null);
                        await load();
                    }}
                />
            )}

            {trackMenu && <ContextMenu x={trackMenu.x} y={trackMenu.y} items={trackMenuItems(trackMenu.track)} onClose={() => setTrackMenu(null)} />}

            {exportFor && (
                <ExportModal
                    tracks={tracks.filter(t => !t.track.archived && t.track.advanceMode !== 'completion').map(t => t.track)}
                    preselected={exportFor}
                    weekStart={weekStart}
                    onClose={() => setExportFor(null)}
                    onExported={path => {
                        setExportFor(null);
                        const file = path.split(/[\\/]/).pop() ?? path;
                        onNotify?.({ message: `Exported "${file}". Import it in your calendar app to see these tracks there.`, type: 'success' });
                    }}
                />
            )}

            {toStartOver && (
                <ConfirmDialog
                    title="Start Over"
                    confirmLabel="Start Over"
                    message={toStartOver.advanceMode === 'completion'
                        ? `Start "${toStartOver.name}" over? It goes back to the first item${toStartOver.loopEntries ? ', in round 1' : ''}, with nothing marked done.\n\nWhat you've done so far isn't lost: Past days on the calendar still show it, and this can be undone.`
                        : `Start "${toStartOver.name}" over from today? The first item moves to the next scheduled day${toStartOver.loopEntries ? ', in round 1' : ''}, with nothing marked done.\n\nWhat you've done so far isn't lost: Past days on the calendar still show it, and this can be undone.`}
                    onConfirm={() => {
                        const t = toStartOver;
                        setToStartOver(null);
                        startOver(t);
                    }}
                    onCancel={() => setToStartOver(null)}
                />
            )}

            {entryToRemove && (
                <ConfirmDialog
                    title="Remove from Track"
                    confirmLabel="Remove"
                    message={entryToRemove.isFolder
                        ? `Remove the folder "${entryToRemove.title}" from "${selected?.track.name ?? 'this track'}"? What's in it stays in the track, in the folder's place.`
                        : `Remove "${entryToRemove.title}" from "${selected?.track.name ?? 'this track'}"?${entryToRemove.done ? " It's marked done, and that will be lost too." : ''}${entryToRemove.videoId ? ' (The video stays in the library.)' : ''}`}
                    onConfirm={() => {
                        const entry = entryToRemove;
                        setEntryToRemove(null);
                        void act(() => removeCalendarEntry(entry.id))();
                    }}
                    onCancel={() => setEntryToRemove(null)}
                />
            )}

            {toDelete && (
                <ConfirmDialog
                    title="Delete Track"
                    message={`Delete the track "${toDelete.name}", with what's been marked done in it? This can't be undone. (Its videos stay in the library.)`}
                    onConfirm={() => {
                        const t = toDelete;
                        setToDelete(null);
                        if (selectedId === t.id) setSelectedId(null);
                        void act(() => deleteCalendarTrack(t.id))();
                    }}
                    onCancel={() => setToDelete(null)}
                />
            )}
        </div>
        </HighlightContext.Provider>
    );
}
