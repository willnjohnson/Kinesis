import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, CalendarClock, CalendarDays, CheckCheck, ChevronLeft, History, Library, NotebookText, Pin, PinOff } from 'lucide-react';
import { CALENDAR_CHANGED_EVENT, calendarToday, clearPins, listCalendarDays, listCalendarTracks, listLogEntries, listLogs, listLogsDue, listPins, listVideosWithTag, LOGS_CHANGED_EVENT, setPinned, videoThumbnail, writeLogDay, type CalendarDayItem, type Log, type MenuVideo } from '../api';
import { BUILT_IN_TAGS } from '../lib/glossary';
import { entryTemplateFor } from '../lib/logs';
import { builtInTagIcon } from '../lib/built-in-tags';
import { useWorkspace } from '../hooks/useWorkspace';
import { MENU_DIVIDER, MENU_PANEL, MENU_ROW } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { barButton } from './TitleBar';
import { addDays } from './calendar/shared';
import { useWatchList, WatchListsModal, type WatchList } from './WatchListsModal';

/** One video in the menu: its thumbnail, title and channel. `onUnpin` adds an unpin button that shows on hover. */
function VideoRow({ video, onOpen, onUnpin }: { video: MenuVideo; onOpen: () => void; onUnpin?: () => void }) {
    return (
        <div className="group relative">
            {/* MENU_ROW's look, but as tall as its thumbnail. */}
            <button
                role="menuitem"
                onClick={onOpen}
                className={`w-full flex items-center gap-2.5 pl-3 py-1.5 rounded-lg text-xs text-left text-gray-200 hover:bg-[#272727] transition-colors cursor-pointer ${onUnpin ? 'pr-8' : 'pr-3'}`}
                title={video.title}
            >
                <img src={videoThumbnail(video.videoId)} alt="" className="w-12 h-[27px] object-cover rounded shrink-0" />
                <span className="flex-1 min-w-0">
                    <span className="block truncate">{video.title || video.videoId}</span>
                    {video.author && <span className="block truncate text-[10px] text-[#888888]">{video.author}</span>}
                </span>
            </button>
            {onUnpin && (
                <button
                    onClick={onUnpin}
                    title="Unpin"
                    aria-label={`Unpin ${video.title}`}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-[#666666] hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                >
                    <PinOff className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
}

/** The submenu that isn't an Essential tag's: the logs, to write today's entry in one. */
const LOG_SUB = '\u0000logs';
const ENTRY_FIELD = 'w-full bg-[#121212] border border-[#333] text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[var(--k-accent)] placeholder-gray-600 disabled:opacity-50';

/**
 * The title bar's pin menu: the pinned videos (newest pin first), then the Essential tags (Watch Later, Favorite, ...),
 * each opening a submenu of the videos carrying it, and Clear pins at the bottom. Picking a video opens it in the sidebar
 * over whatever view is open. Pins are the reader's own (db/pins.rs), so this works in a read-only workspace too.
 * Hidden on the Workspaces screen (index.css), and waits while a dialog is open, like the bar's other buttons.
 */
export function PinsMenu({ locked, onOpenVideo, onShowTag, onPinsChanged, onOpenCalendar, onOpenLog }: {
    locked: boolean;
    onOpenVideo: (videoId: string) => void;
    /** "Show all in Library" for a tag: the Library, filtered to it. */
    onShowTag: (tag: string) => void;
    /** After pins change here (an unpin, Clear pins), so the sidebar's pin button can follow. */
    onPinsChanged: () => void;
    /** The "due today" and "to do tomorrow" rows' destination (`date`: the day to show); without it (the Calendar
     *  hidden here) there are no rows. */
    onOpenCalendar?: (date?: string) => void;
    /** Opens a log on today's row, ready to type in: where the reminders (logs with their bell on and nothing written
     *  today) and Log Entry go. Without it (Logs hidden here) there are neither. */
    onOpenLog?: (logId: string) => void;
}) {
    const { labels } = useWorkspace();
    const [open, setOpen] = useState(false);
    const [pins, setPins] = useState<MenuVideo[]>([]);
    // Today on the Calendar: what's scheduled today and not done yet, and how many tracks have fallen behind. And what's
    // scheduled tomorrow, as a look ahead (not part of the button's count).
    const [today, setToday] = useState<{ due: number; overdue: number; tomorrow: number; tomorrowDate: string } | null>(null);
    const loadToday = useCallback(() => {
        if (!onOpenCalendar) return;
        const day = calendarToday();
        const next = addDays(day, 1);
        const open = (i: CalendarDayItem, on: string) => i.date === on && i.kind === 'scheduled' && !i.isFolder && !i.done;
        Promise.all([listCalendarDays(day, next), listCalendarTracks()])
            .then(([items, tracks]) => setToday({
                due: items.filter(i => open(i, day)).length,
                overdue: tracks.filter(t => t.state.currentOverdue).length,
                tomorrow: items.filter(i => open(i, next)).length,
                tomorrowDate: next,
            }))
            .catch(() => setToday(null));
    }, [!!onOpenCalendar]); // eslint-disable-line react-hooks/exhaustive-deps
    // Kept current without opening the menu (the count shows on the button): at the start, whenever the Calendar
    // changes, when the window comes back into focus, and each minute (which also turns it over at midnight).
    useEffect(() => {
        if (!onOpenCalendar) { setToday(null); return; }
        loadToday();
        const every = window.setInterval(loadToday, 60_000);
        window.addEventListener(CALENDAR_CHANGED_EVENT, loadToday);
        window.addEventListener('focus', loadToday);
        return () => {
            window.clearInterval(every);
            window.removeEventListener(CALENDAR_CHANGED_EVENT, loadToday);
            window.removeEventListener('focus', loadToday);
        };
    }, [loadToday]); // eslint-disable-line react-hooks/exhaustive-deps
    // Logs: the ones to be reminded of (bell on, nothing written today), kept current as the Calendar's count is; and
    // all of them, for Log Entry's submenu, read when the menu opens.
    const [dueLogs, setDueLogs] = useState<Log[]>([]);
    const [logs, setLogs] = useState<Log[] | null>(null);
    const loadLogs = useCallback(() => {
        if (!onOpenLog) return;
        listLogsDue().then(setDueLogs).catch(() => setDueLogs([]));
    }, [!!onOpenLog]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!onOpenLog) { setDueLogs([]); return; }
        loadLogs();
        const every = window.setInterval(loadLogs, 60_000);
        window.addEventListener(LOGS_CHANGED_EVENT, loadLogs);
        window.addEventListener('focus', loadLogs);
        return () => {
            window.clearInterval(every);
            window.removeEventListener(LOGS_CHANGED_EVENT, loadLogs);
            window.removeEventListener('focus', loadLogs);
        };
    }, [loadLogs]); // eslint-disable-line react-hooks/exhaustive-deps
    const unlogged = onOpenLog ? dueLogs.length : 0;
    const calendarDue = onOpenCalendar && today ? today.due : 0;
    // The button's count: what's due on the Calendar today, and the logs waiting for today's entry.
    const dueToday = calendarDue + unlogged;
    const dueWords = [
        ...(calendarDue > 0 ? [`${calendarDue} due today`] : []),
        ...(unlogged > 0 ? [`${unlogged} ${unlogged === 1 ? 'log' : 'logs'} without an entry today`] : []),
    ].join(', ');
    const [confirmClear, setConfirmClear] = useState(false);
    // Continue Watching and Watched (WatchListsModal.tsx): their counts here, and which window is open.
    const continuing = useWatchList('continue');
    const watched = useWatchList('watched');
    const [watchList, setWatchList] = useState<WatchList | null>(null);
    // The Essential tag whose submenu is open, where its row sits (the submenu lines up with it), and its videos.
    const [sub, setSub] = useState<{ tag: string; top: number } | null>(null);
    const [subVideos, setSubVideos] = useState<MenuVideo[] | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const subRef = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<{ right: number; top: number }>({ right: 6, top: 0 });
    const [subAt, setSubAt] = useState<{ right: number; top: number } | null>(null);

    const refresh = useCallback(() => { listPins().then(setPins).catch(() => setPins([])); }, []);
    const close = useCallback(() => { setOpen(false); setSub(null); setWriting(null); setSavedLog(null); }, []);
    // Log Entry: the log whose today is being written in the submenu (its two cells, as they'll be saved), and the one
    // just saved. While one is being written the submenu stays, wherever the pointer goes in the menu beside it:
    // words half typed aren't dropped for brushing another row.
    const [writing, setWriting] = useState<{ log: Log; top: number; title: string; description: string; loaded: boolean; saving: boolean; error: string | null } | null>(null);
    const [savedLog, setSavedLog] = useState<string | null>(null);
    const entryRef = useRef<HTMLInputElement>(null);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const startEntry = (log: Log) => {
        const day = calendarToday();
        setSavedLog(null);
        setWriting({ log, top: sub?.top ?? 0, title: '', description: '', loaded: false, saving: false, error: null });
        listLogEntries(log.id)
            .then(rows => {
                const row = rows.find(r => r.date === day);
                setWriting(w => w && w.log.id === log.id ? { ...w, title: row?.title ?? entryTemplateFor(log.entryTemplate, day), description: row?.description ?? '', loaded: true } : w);
                window.setTimeout(() => entryRef.current?.focus(), 0);
            })
            .catch(() => setWriting(w => w && w.log.id === log.id ? { ...w, loaded: true } : w));
    };
    const saveEntry = () => {
        const w = writing;
        if (!w || !w.loaded || w.saving) return;
        setWriting({ ...w, saving: true, error: null });
        writeLogDay(w.log.id, calendarToday(), w.title, w.description)
            .then(() => {
                setWriting(null);
                setSavedLog(w.log.id);
                listLogs().then(setLogs).catch(() => {});
            })
            .catch(e => setWriting(cur => cur && { ...cur, saving: false, error: (typeof e === 'string' ? e : (e as Error)?.message ?? String(e)).replace(/^Invalid parameter: /, '') }));
    };
    const logPanel = writing ? { top: writing.top } : sub?.tag === LOG_SUB ? sub : null;

    // Below the button, its right edge lined up with the button's (it sits near the window's right edge).
    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;
        const r = buttonRef.current.getBoundingClientRect();
        setAt({ right: Math.max(6, window.innerWidth - r.right), top: r.bottom + 4 });
    }, [open]);

    // A submenu opens to the menu's left (the menu is at the window's right edge), its top at its row's, kept inside the window.
    useLayoutEffect(() => {
        const anchor = writing ?? sub;
        if (!anchor || !boxRef.current) { setSubAt(null); return; }
        const box = boxRef.current.getBoundingClientRect();
        const h = subRef.current?.offsetHeight ?? 0;
        setSubAt({ right: window.innerWidth - box.left - 2, top: Math.max(6, Math.min(anchor.top - 4, window.innerHeight - h - 6)) });
    }, [sub, subVideos, logs, writing?.log.id, writing?.loaded, writing?.error]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!sub || sub.tag === LOG_SUB) return;
        let live = true;
        setSubVideos(null);
        listVideosWithTag(sub.tag).then(v => { if (live) setSubVideos(v); }).catch(() => { if (live) setSubVideos([]); });
        return () => { live = false; };
    }, [sub?.tag]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closes on a press outside it (not on its own button, which toggles it), Esc, a resize or the window losing focus.
    // Not on a scroll: its own lists scroll.
    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => {
            const t = e.target as Node;
            if (boxRef.current?.contains(t) || subRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
            close();
        };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
        document.addEventListener('mousedown', away, true);
        document.addEventListener('keydown', escape);
        window.addEventListener('resize', close);
        window.addEventListener('blur', close);
        return () => {
            document.removeEventListener('mousedown', away, true);
            document.removeEventListener('keydown', escape);
            window.removeEventListener('resize', close);
            window.removeEventListener('blur', close);
        };
    }, [open, close]);

    // A dialog opening (the sidebar's leave prompt, say) closes it.
    useEffect(() => { if (locked) close(); }, [locked, close]);

    const openVideo = (id: string) => { close(); onOpenVideo(id); };
    const openLog = (id: string) => { close(); onOpenLog?.(id); };
    const unpin = (id: string) => {
        setPins(prev => prev.filter(p => p.videoId !== id));
        setPinned(id, false).catch(() => {}).finally(() => { refresh(); onPinsChanged(); });
    };

    return (
        <>
            <button
                ref={buttonRef}
                data-pins-button
                onClick={() => { if (open) close(); else { refresh(); loadToday(); loadLogs(); if (onOpenLog) listLogs().then(setLogs).catch(() => setLogs([])); continuing.refresh(); watched.refresh(); setOpen(true); } }}
                disabled={locked && !open}
                // With something due today, its count sits before the pin (where What's New puts its unread dot), in the
                // bar's light text rather than the accent: noticeable, not loud.
                className={`${dueToday > 0 ? barButton.replace('w-[22px]', 'min-w-[22px] px-1.5 gap-1') : barButton} ${open ? 'bg-[#272727] text-white' : ''}`}
                title={locked ? 'Pinned (close the open window first)' : dueToday > 0 ? `Pinned · ${dueWords}` : 'Pinned'}
                aria-label={dueToday > 0 ? `Pinned, ${dueWords}` : 'Pinned'}
                aria-expanded={open}
            >
                {dueToday > 0 && <span className="text-[11px] font-semibold leading-none text-gray-200 tabular-nums">{dueToday > 99 ? '99+' : dueToday}</span>}
                <Pin className="w-3.5 h-3.5" />
            </button>

            {open && createPortal(
                <>
                    <div
                        ref={boxRef}
                        role="menu"
                        style={{ right: at.right, top: at.top }}
                        // Above the title bar (z-300), like its window menu.
                        className={`fixed z-[320] w-72 ${MENU_PANEL}`}
                        onContextMenu={e => e.preventDefault()}
                    >
                        <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#888888]">Pinned</div>
                        <div className="max-h-72 overflow-y-auto custom-scrollbar" onMouseEnter={() => setSub(null)}>
                            {pins.length === 0 ? (
                                <p className="px-3 py-2 text-[11px] text-[#888888] leading-relaxed">
                                    Pin videos you're working on now, to reach them from anywhere. The pin is beside the video sidebar's close button.
                                </p>
                            ) : pins.map(v => <VideoRow key={v.videoId} video={v} onOpen={() => openVideo(v.videoId)} onUnpin={() => unpin(v.videoId)} />)}
                        </div>
                        {/* What's due today on the Calendar, as a count: clicking it goes there. */}
                        {onOpenCalendar && today && (
                            <>
                                <div className={MENU_DIVIDER} />
                                <button
                                    role="menuitem"
                                    onMouseEnter={() => setSub(null)}
                                    onClick={() => { close(); onOpenCalendar(calendarToday()); }}
                                    className={`${MENU_ROW} text-gray-200`}
                                    title={`Open ${labels.aliasCalendar}`}
                                >
                                    <CalendarDays className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />
                                    <span className="flex-1 truncate">
                                        {today.due === 0 ? 'Nothing due today' : `${today.due} ${today.due === 1 ? 'task' : 'tasks'} due today`}
                                        {today.overdue > 0 && <span className="text-red-400"> · {today.overdue} overdue</span>}
                                    </span>
                                </button>
                                {/* A look ahead, only when tomorrow has something: opens the Calendar on tomorrow. */}
                                {today.tomorrow > 0 && (
                                    <button
                                        role="menuitem"
                                        onMouseEnter={() => setSub(null)}
                                        onClick={() => { close(); onOpenCalendar(today.tomorrowDate); }}
                                        className={`${MENU_ROW} text-[#aaaaaa]`}
                                        title={`Open ${labels.aliasCalendar} on tomorrow`}
                                    >
                                        <CalendarClock className="w-3.5 h-3.5 shrink-0 text-[#888888]" />
                                        <span className="flex-1 truncate">{today.tomorrow} to do tomorrow</span>
                                    </button>
                                )}
                            </>
                        )}
                        {/* Logs: Log Entry, whose submenu is every log (picking one goes to today's row of it). The
                            count beside it is the logs with their bell on and nothing written today, which the submenu
                            marks with a bell. */}
                        {onOpenLog && (
                            <>
                                <div className={MENU_DIVIDER} />
                                <button
                                    role="menuitem"
                                    aria-haspopup="menu"
                                    aria-expanded={sub?.tag === LOG_SUB}
                                    onMouseEnter={e => setSub({ tag: LOG_SUB, top: e.currentTarget.getBoundingClientRect().top })}
                                    onClick={e => setSub({ tag: LOG_SUB, top: e.currentTarget.getBoundingClientRect().top })}
                                    className={`${MENU_ROW} text-gray-200 ${sub?.tag === LOG_SUB ? 'bg-[#272727]' : ''}`}
                                    title="Write today's entry in one of your logs"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5 shrink-0 text-[#666666]" />
                                    <span className="flex-1 truncate">Log Entry</span>
                                    {unlogged > 0 && <span className="flex items-center gap-1 text-[11px] text-[var(--k-accent)] tabular-nums" title={`${unlogged} ${unlogged === 1 ? 'log' : 'logs'} without an entry today`}><BellRing className="w-3 h-3" />{unlogged}</span>}
                                    <NotebookText className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />
                                </button>
                            </>
                        )}
                        <div className={MENU_DIVIDER} />
                        {BUILT_IN_TAGS.map(tag => {
                            const Icon = builtInTagIcon(tag);
                            return (
                                <button
                                    key={tag}
                                    role="menuitem"
                                    aria-haspopup="menu"
                                    aria-expanded={sub?.tag === tag}
                                    onMouseEnter={e => setSub({ tag, top: e.currentTarget.getBoundingClientRect().top })}
                                    onClick={e => setSub({ tag, top: e.currentTarget.getBoundingClientRect().top })}
                                    className={`${MENU_ROW} text-gray-200 ${sub?.tag === tag ? 'bg-[#272727]' : ''}`}
                                >
                                    {/* Pointing left: the submenu opens on that side. */}
                                    <ChevronLeft className="w-3.5 h-3.5 shrink-0 text-[#666666]" />
                                    <span className="flex-1 truncate">{tag}</span>
                                    {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />}
                                </button>
                            );
                        })}
                        {/* What's been watched: started and not finished, and finished. Each opens its own window. */}
                        <div className={MENU_DIVIDER} />
                        {([
                            ['continue', 'Continue Watching', History, continuing.videos?.length ?? 0],
                            ['watched', 'Watched', CheckCheck, watched.videos?.length ?? 0],
                        ] as const).map(([list, label, Icon, count]) => (
                            <button
                                key={list}
                                role="menuitem"
                                onMouseEnter={() => setSub(null)}
                                onClick={() => { close(); setWatchList(list); }}
                                className={`${MENU_ROW} text-gray-200`}
                            >
                                <Icon className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />
                                <span className="flex-1 truncate">{label}</span>
                                {count > 0 && <span className="text-[11px] text-[#888888] tabular-nums">{count}</span>}
                            </button>
                        ))}
                        <div className={MENU_DIVIDER} />
                        <button
                            role="menuitem"
                            onMouseEnter={() => setSub(null)}
                            disabled={pins.length === 0}
                            onClick={() => { close(); setConfirmClear(true); }}
                            className={`${MENU_ROW} text-red-400`}
                        >
                            <PinOff className="w-3.5 h-3.5 shrink-0" />
                            <span className="flex-1">Clear pins</span>
                        </button>
                    </div>

                    {logPanel && (
                        <div
                            ref={subRef}
                            role="menu"
                            aria-label="Log Entry"
                            style={subAt ? { right: subAt.right, top: subAt.top } : { visibility: 'hidden', right: 0, top: 0 }}
                            className={`fixed z-[321] ${writing ? 'w-80' : 'w-60'} ${MENU_PANEL}`}
                            onContextMenu={e => e.preventDefault()}
                        >
                            {writing ? (
                                // Today's row of one log, written here: what's there already is shown to be changed, and
                                // Save writes the day as the sheet would (emptied of both, the row is removed).
                                <div className="p-2">
                                    <div className="flex items-center gap-1 mb-2">
                                        <button type="button" onClick={() => setWriting(null)} className="p-1 rounded-md text-[#888888] hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Back to the logs" aria-label="Back to the logs">
                                            <ChevronLeft className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">{writing.log.name}</span>
                                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#888888]">Today</span>
                                    </div>
                                    <input
                                        ref={entryRef}
                                        value={writing.title}
                                        disabled={!writing.loaded}
                                        onChange={e => setWriting(w => w && { ...w, title: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) saveEntry(); else descriptionRef.current?.focus(); } }}
                                        maxLength={200}
                                        placeholder={writing.loaded ? 'Entry' : 'Loading...'}
                                        aria-label="Entry"
                                        className={`${ENTRY_FIELD} font-semibold`}
                                    />
                                    <textarea
                                        ref={descriptionRef}
                                        value={writing.description}
                                        disabled={!writing.loaded}
                                        onChange={e => setWriting(w => w && { ...w, description: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEntry(); } }}
                                        rows={3}
                                        maxLength={5000}
                                        placeholder="Description"
                                        aria-label="Description"
                                        className={`${ENTRY_FIELD} mt-1.5 resize-none leading-relaxed custom-scrollbar`}
                                    />
                                    {writing.error && <p className="mt-1.5 text-[11px] text-red-400 leading-relaxed">{writing.error}</p>}
                                    <div className="mt-2 flex items-center gap-2">
                                        <button type="button" onClick={() => openLog(writing.log.id)} className="text-[11px] font-semibold text-[#888888] hover:text-white transition-colors cursor-pointer" title={`Open "${writing.log.name}" in ${labels.aliasLogs}, on today's row`}>
                                            Open log
                                        </button>
                                        <span className="flex-1" />
                                        <button
                                            type="button"
                                            onClick={saveEntry}
                                            disabled={!writing.loaded || writing.saving}
                                            title="Save today's entry (Ctrl+Enter)"
                                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#888888]">Today's entry in</div>
                                    <div className="max-h-72 overflow-y-auto custom-scrollbar">
                                        {logs === null ? (
                                            <p className="px-3 py-2 text-[11px] text-[#888888]">Loading...</p>
                                        ) : logs.length === 0 ? (
                                            <p className="px-3 py-2 text-[11px] text-[#888888] leading-relaxed">No logs yet. Make one in {labels.aliasLogs}.</p>
                                        ) : logs.map(l => (
                                            <button key={l.id} role="menuitem" onClick={() => startEntry(l)} className={`${MENU_ROW} text-gray-200`}>
                                                <span className="flex-1 truncate">{l.name}</span>
                                                {savedLog === l.id && <span className="text-[10px] text-[#888888]">Saved</span>}
                                                {dueLogs.some(d => d.id === l.id) && <BellRing className="w-3 h-3 shrink-0 text-[var(--k-accent)]" />}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    {sub && sub.tag !== LOG_SUB && !writing && (
                        <div
                            ref={subRef}
                            role="menu"
                            aria-label={sub.tag}
                            style={subAt ? { right: subAt.right, top: subAt.top } : { visibility: 'hidden', right: 0, top: 0 }}
                            className={`fixed z-[321] w-72 ${MENU_PANEL}`}
                            onContextMenu={e => e.preventDefault()}
                        >
                            <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#888888]">{sub.tag}</div>
                            <div className="max-h-72 overflow-y-auto custom-scrollbar">
                                {subVideos === null ? (
                                    <p className="px-3 py-2 text-[11px] text-[#888888]">Loading...</p>
                                ) : subVideos.length === 0 ? (
                                    <p className="px-3 py-2 text-[11px] text-[#888888]">No videos tagged {sub.tag} yet.</p>
                                ) : subVideos.map(v => <VideoRow key={v.videoId} video={v} onOpen={() => openVideo(v.videoId)} />)}
                            </div>
                            <div className={MENU_DIVIDER} />
                            <button role="menuitem" onClick={() => { const tag = sub.tag; close(); onShowTag(tag); }} className={`${MENU_ROW} text-gray-200`}>
                                <Library className="w-3.5 h-3.5 shrink-0 text-[#aaaaaa]" />
                                <span className="flex-1">Show all in {labels.aliasLibrary}</span>
                            </button>
                        </div>
                    )}
                </>,
                document.body,
            )}

            {watchList && <WatchListsModal list={watchList} onClose={() => setWatchList(null)} onOpenVideo={onOpenVideo} />}

            {confirmClear && (
                <ConfirmDialog
                    title="Clear Pins"
                    confirmLabel="Clear Pins"
                    message={`Unpin all ${pins.length} video${pins.length === 1 ? '' : 's'}? The videos themselves stay where they are.`}
                    onConfirm={() => {
                        setConfirmClear(false);
                        clearPins().catch(() => {}).finally(() => { setPins([]); onPinsChanged(); });
                    }}
                    onCancel={() => setConfirmClear(false)}
                />
            )}
        </>
    );
}
