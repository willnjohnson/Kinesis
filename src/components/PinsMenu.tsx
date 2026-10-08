import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, CalendarDays, CheckCheck, ChevronLeft, History, Library, Pin, PinOff } from 'lucide-react';
import { CALENDAR_CHANGED_EVENT, calendarToday, clearPins, listCalendarDays, listCalendarTracks, listPins, listVideosWithTag, setPinned, videoThumbnail, type CalendarDayItem, type MenuVideo } from '../api';
import { BUILT_IN_TAGS } from '../lib/glossary';
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

/**
 * The title bar's pin menu: the pinned videos (newest pin first), then the Essential tags (Watch Later, Favorite, ...),
 * each opening a submenu of the videos carrying it, and Clear pins at the bottom. Picking a video opens it in the sidebar
 * over whatever view is open. Pins are the reader's own (db/pins.rs), so this works in a read-only workspace too.
 * Hidden on the Workspaces screen (index.css), and waits while a dialog is open, like the bar's other buttons.
 */
export function PinsMenu({ locked, onOpenVideo, onShowTag, onPinsChanged, onOpenCalendar }: {
    locked: boolean;
    onOpenVideo: (videoId: string) => void;
    /** "Show all in Library" for a tag: the Library, filtered to it. */
    onShowTag: (tag: string) => void;
    /** After pins change here (an unpin, Clear pins), so the sidebar's pin button can follow. */
    onPinsChanged: () => void;
    /** The "due today" and "to do tomorrow" rows' destination (`date`: the day to show); without it (the Calendar
     *  hidden here) there are no rows. */
    onOpenCalendar?: (date?: string) => void;
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
    const dueToday = onOpenCalendar && today ? today.due : 0;
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
    const close = useCallback(() => { setOpen(false); setSub(null); }, []);

    // Below the button, its right edge lined up with the button's (it sits near the window's right edge).
    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;
        const r = buttonRef.current.getBoundingClientRect();
        setAt({ right: Math.max(6, window.innerWidth - r.right), top: r.bottom + 4 });
    }, [open]);

    // A submenu opens to the menu's left (the menu is at the window's right edge), its top at its row's, kept inside the window.
    useLayoutEffect(() => {
        if (!sub || !boxRef.current) { setSubAt(null); return; }
        const box = boxRef.current.getBoundingClientRect();
        const h = subRef.current?.offsetHeight ?? 0;
        setSubAt({ right: window.innerWidth - box.left - 2, top: Math.max(6, Math.min(sub.top - 4, window.innerHeight - h - 6)) });
    }, [sub, subVideos]);

    useEffect(() => {
        if (!sub) return;
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
    const unpin = (id: string) => {
        setPins(prev => prev.filter(p => p.videoId !== id));
        setPinned(id, false).catch(() => {}).finally(() => { refresh(); onPinsChanged(); });
    };

    return (
        <>
            <button
                ref={buttonRef}
                data-pins-button
                onClick={() => { if (open) close(); else { refresh(); loadToday(); continuing.refresh(); watched.refresh(); setOpen(true); } }}
                disabled={locked && !open}
                // With something due today, its count sits before the pin (where What's New puts its unread dot), in the
                // bar's light text rather than the accent: noticeable, not loud.
                className={`${dueToday > 0 ? barButton.replace('w-[22px]', 'min-w-[22px] px-1.5 gap-1') : barButton} ${open ? 'bg-[#272727] text-white' : ''}`}
                title={locked ? 'Pinned (close the open window first)' : dueToday > 0 ? `Pinned · ${dueToday} due today` : 'Pinned'}
                aria-label={dueToday > 0 ? `Pinned, ${dueToday} due today` : 'Pinned'}
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

                    {sub && (
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
