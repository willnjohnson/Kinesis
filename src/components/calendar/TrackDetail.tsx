import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ArrowLeft, BookOpenText, ChevronDown, ChevronRight, Folder, FolderPlus, GripVertical, ListPlus, NotebookPen, Pencil, Repeat, RotateCcw, Trash2, Undo2, Video as VideoIcon, X } from 'lucide-react';
import { getSavedVideos, listNotes, listPins, listWorkbooks, searchLibrary, videoThumbnail, calendarToday, type CalendarEntry, type CalendarTrackSummary } from '../../api';
import { noteDisplayTitle } from '../../lib/notes';
import { useWorkspace } from '../../hooks/useWorkspace';
import { handlePlainContextMenu } from '../../lib/markdown-editor';
import { useDragReorder, DropIndicator, type DropPlace } from '../../hooks/useDragReorder';
import { InProgressIcon } from '../ui/MarkIcons';
import { MODE_LABEL, repeatLabel, trackColor, niceDate, trackTime, statusLine, PriorityMark, Marked, EntryTitle } from './shared';
import { ConfirmDialog } from '../ConfirmDialog';

/**
 * Where a drag leaves a track's entries (each folder followed by what's in it), or null when the drop changes nothing.
 * Dropped onto an entry in a folder, the dragged entry joins that folder; onto a folder's lower half, it goes in first
 * (unless the folder is collapsed: then just after it); anywhere else, the top level. A folder moves with everything in
 * it, only among the top level.
 */
function relayout(all: CalendarEntry[], drop: DropPlace, collapsed: Set<number>): CalendarEntry[] | null {
    const moved = all.find(e => e.id === drop.from);
    const target = all.find(e => e.id === drop.to);
    if (!moved || !target || moved === target) return null;
    const inside = (folderId: number) => all.filter(e => e.folderId === folderId);
    if (moved.isFolder) {
        const block = [moved, ...inside(moved.id)];
        if (target.folderId === moved.id) return null;
        const rest = all.filter(e => !block.includes(e));
        // Relative to the target's group: its folder (with what's in it), or the target itself.
        const header = target.folderId !== null ? rest.find(e => e.id === target.folderId)! : target;
        const start = rest.indexOf(header);
        const at = drop.side === 'before' && target === header ? start : start + 1 + (header.isFolder ? inside(header.id).length : 0);
        return [...rest.slice(0, at), ...block, ...rest.slice(at)];
    }
    const rest = all.filter(e => e !== moved);
    const index = rest.indexOf(target);
    let folderId: number | null;
    let at: number;
    if (target.folderId !== null) {
        folderId = target.folderId;
        at = drop.side === 'before' ? index : index + 1;
    } else if (target.isFolder && drop.side === 'after') {
        if (collapsed.has(target.id)) {
            folderId = null;
            at = index + 1 + inside(target.id).length;
        } else {
            folderId = target.id;
            at = index + 1;
        }
    } else {
        folderId = null;
        at = drop.side === 'before' ? index : index + 1;
    }
    return [...rest.slice(0, at), { ...moved, folderId }, ...rest.slice(at)];
}

/** A track opened in the panel: what it is, and its entries to check off, add to or remove. */
export function TrackDetail({ summary, canEdit, fits, onBack, onOpenVideo, onMark, onProgress, onRemove, onAddVideo, onAddNote, onAddWorkbook, onTask, onNewFolder, onLayout, onEdit, onStartOver, onUndoStartOver, onArchive, onDelete }: {
    summary: CalendarTrackSummary;
    canEdit: boolean;
    /** While the search bar filters items: whether an entry fits (the rest are dimmed, so the ones that fit stand out). */
    fits?: (entry: CalendarEntry, overdue: boolean) => boolean;
    onBack: () => void;
    onOpenVideo: (videoId: string) => void;
    onMark: (entry: CalendarEntry, done: boolean) => void;
    /** Marks an entry In progress, or clears it. */
    onProgress: (entry: CalendarEntry, on: boolean) => void;
    onRemove: (entry: CalendarEntry) => void;
    onAddVideo: (videoId: string) => void;
    /** Adds a note (the Notes section) to the end of the track. Left out when the Notes section is hidden. */
    onAddNote?: (noteId: string) => void;
    /** Adds a workbook's notes, in its order (where notes can be added). */
    onAddWorkbook?: (workbookId: string) => void;
    /** Opens the task window: for a new task (no entry), or to edit one (a folder too). */
    onTask: (entry: CalendarEntry | null) => void;
    /** Opens the window for a new folder. */
    onNewFolder: () => void;
    /** The entries laid out anew by a drag: every entry in reading order, each with its folder. */
    onLayout: (layout: { id: number; folderId: number | null }[]) => void;
    onEdit: () => void;
    onStartOver: () => void;
    onUndoStartOver: () => void;
    onArchive: () => void;
    onDelete: () => void;
}) {
    const { labels } = useWorkspace();
    const { track, state } = summary;
    // Dragged into a new order, shown at once (the saved order arrives with the next load). A track that follows its
    // Drive's sequence is ordered by that sequence instead, so it isn't dragged here.
    const canReorder = canEdit && !track.sourceDriveSequence;
    const [entries, setEntries] = useState(state.entries);
    useEffect(() => setEntries(state.entries), [state.entries]);
    // Folders folded shut (theirs hidden); open by default.
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    const toggleFolder = (id: number) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const shown = entries.filter(e => e.folderId === null || !collapsed.has(e.folderId));
    const drag = useDragReorder(shown, e => (e.id > 0 ? e.id : `v${e.videoId}`));
    // The hook's own order only knows the rows on show; where the drop landed decides the layout (folders included).
    const dropped = (_order: CalendarEntry[], drop: DropPlace) => {
        const next = relayout(entries, drop, collapsed);
        if (!next) return;
        setEntries(next);
        onLayout(next.map(e => ({ id: e.id, folderId: e.folderId })));
    };
    const countIn = (folderId: number) => entries.filter(e => e.folderId === folderId);
    // Checking off an item for a day after today: ask first, so a stray click doesn't mark a future item.
    const [marking, setMarking] = useState<CalendarEntry | null>(null);
    const today = calendarToday();
    const requestMark = (entry: CalendarEntry, done: boolean) => {
        if (done && entry.dueDate && entry.dueDate > today) setMarking(entry);
        else onMark(entry, done);
    };
    const confirmMark = () => {
        const entry = marking;
        setMarking(null);
        if (entry) onMark(entry, true);
    };
    // Which entry is up, by identity: the dragged order can differ from the saved one for a moment.
    const currentEntry = state.current !== null ? state.entries[state.current] : null;
    const status = statusLine(summary);
    const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    return (
        // As tall as the column gives it (down to New Track): the heading stays at the top and the Add row at the
        // foot, and the items scroll between them.
        <div className="h-full min-h-[16rem] flex flex-col bg-[#121212] rounded-xl border border-[#272727]">
            <div className="shrink-0 p-3 border-b border-[#222]">
                <div className="flex items-center gap-1">
                    <button onClick={onBack} className="p-1 -ml-1 rounded text-gray-500 hover:text-white transition-colors cursor-pointer" title="All tracks"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-1" style={{ backgroundColor: trackColor(track.id) }} />
                    <h3 className="text-sm font-bold text-white truncate ml-1.5 flex-1" title={track.name}><Marked text={track.name} of="track" /></h3>
                    {canEdit && (
                        <>
                            <button onClick={onEdit} className="p-1 text-gray-500 hover:text-blue-400 transition-colors cursor-pointer" title="Edit track"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={onStartOver} className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer" title="Start over from today: the first item again, round 1"><RotateCcw className="w-3.5 h-3.5" /></button>
                            {state.canUndoStartOver && (
                                <button onClick={onUndoStartOver} className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer" title="Undo Start over: back to the start date and round it had before"><Undo2 className="w-3.5 h-3.5" /></button>
                            )}
                            <button onClick={onArchive} className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer" title={track.archived ? 'Unarchive' : 'Archive'}>
                                {track.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={onDelete} className="p-1 text-gray-500 hover:text-red-500 transition-colors cursor-pointer" title="Delete track"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className="px-1.5 py-0.5 rounded bg-[#222] border border-[#333] text-[10px] font-bold text-gray-400">{MODE_LABEL[track.advanceMode]}</span>
                    {track.loopEntries && <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#222] border border-[#333] text-[10px] font-bold text-gray-400"><Repeat className="w-3 h-3" /> Round {state.round + 1}</span>}
                    {track.drive && <span className="px-1.5 py-0.5 rounded bg-[#222] border border-[#333] text-[10px] font-bold text-gray-400">{track.drive}</span>}
                    {track.advanceMode !== 'completion' && (
                        <span className="text-[10px] text-gray-500">
                            {repeatLabel(track.repeat, track.weekdays)}
                            {` · ${trackTime(track) ?? 'any time'}`}
                        </span>
                    )}
                </div>
                <p className={`text-[11px] mt-2 ${status.tone === 'overdue' ? 'text-red-400' : status.tone === 'done' ? 'text-green-400' : 'text-gray-500'}`}>{status.text}</p>
                {state.total > 0 && (
                    <div className="mt-2 h-1 rounded-full bg-[#272727] overflow-hidden">
                        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: trackColor(track.id) }} />
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2">
                {entries.length === 0 && <p className="text-[11px] text-gray-500 italic px-1 py-1">Nothing in this track yet.</p>}
                <ol className="space-y-0.5">
                    {shown.map(entry => entry.isFolder ? (
                        // A folder: a group of what follows it that shares one place (one day, on a dated track). Its box
                        // checks off everything in it; its In progress shows by itself.
                        <li key={`f${entry.id}`} className="space-y-0.5">
                            <div
                                {...(canReorder ? drag.rowProps(entry, dropped) : {})}
                                className={`group relative flex items-center gap-2 px-1.5 py-1 rounded-md bg-[#181818] ${drag.isDragging(entry) || (fits && !fits(entry, false)) ? 'opacity-40' : ''}`}
                            >
                                {canReorder && <DropIndicator side={drag.dropSide(entry)} />}
                                {canReorder && <GripVertical className="w-3 h-3 shrink-0 -ml-1 -mr-1.5 text-[#555555] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />}
                                <input
                                    type="checkbox"
                                    checked={entry.done}
disabled={countIn(entry.id).length === 0}
                                    onChange={e => requestMark(entry, e.target.checked)}
                                    className="cursor-pointer shrink-0 disabled:cursor-default"
                                    title={entry.done ? 'Mark everything in it not done' : 'Mark everything in it done'}
                                />
                                <button type="button" onClick={() => toggleFolder(entry.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer" title={collapsed.has(entry.id) ? 'Show what is in it' : 'Fold it shut'}>
                                    {collapsed.has(entry.id) ? <ChevronRight className="w-3 h-3 shrink-0 text-gray-500" /> : <ChevronDown className="w-3 h-3 shrink-0 text-gray-500" />}
                                    <Folder className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                                    <span className={`text-xs font-semibold truncate ${entry.done ? 'text-gray-500 line-through' : 'text-gray-100'}`}><Marked text={entry.title} of="item" /></span>
                                    <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
                                        {countIn(entry.id).filter(e => e.done).length}/{countIn(entry.id).length}
                                    </span>
                                </button>
                                {/* No priority of its own (what's in it has one): an empty slot keeps the dates in line. */}
                                <span className="w-3 shrink-0" aria-hidden />
                                {track.advanceMode !== 'completion' && (
                                    <span className="w-[4.75rem] shrink-0 text-right text-[10px] text-gray-500 tabular-nums">{niceDate(entry.dueDate)}</span>
                                )}
                                <span className="shrink-0 flex items-center">
                                    {entry.inProgress
                                        ? <span className="p-0.5 text-amber-400" title="In progress: some of it is started or done"><InProgressIcon className="w-3 h-3" /></span>
                                        : <span className="w-4" aria-hidden />}
                                    {canEdit && (
                                        <button onClick={() => onTask(entry)} className="p-0.5 text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer" title="Edit folder">
                                            <Pencil className="w-3 h-3" />
                                        </button>
                                    )}
                                    {canEdit && (
                                        <button onClick={() => onRemove(entry)} className="p-0.5 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer" title="Remove folder (what's in it stays in the track)">
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </span>
                            </div>
                            {!collapsed.has(entry.id) && countIn(entry.id).length === 0 && (
                                <p className="ml-6 pl-2 py-0.5 text-[10px] text-gray-600 italic">Empty. Drag a video or task onto the lower half of the folder's row to put it in.</p>
                            )}
                        </li>
                    ) : (
                        <li
                            key={entry.id > 0 ? `e${entry.id}` : `v${entry.videoId}`}
                            {...(canReorder ? drag.rowProps(entry, dropped) : {})}
                            // relative: anchors DropIndicator, the line in the gap above/below this row while dragging. One
                            // in a folder is indented under it, with a line down its left.
                            className={`group relative flex items-center gap-2 px-1.5 py-1 rounded-md ${entry.folderId !== null ? 'ml-4 pl-2.5 border-l border-[#2c2c2c] rounded-l-none' : ''} ${entry === currentEntry ? 'bg-[#1a1a1a]' : ''} ${drag.isDragging(entry) || (fits && !fits(entry, entry === currentEntry && state.currentOverdue)) ? 'opacity-40' : ''}`}
                        >
                            {canReorder && <DropIndicator side={drag.dropSide(entry)} />}
                            {/* A visual cue only: the whole row is what's dragged (as in the Attachments list). -mr-1.5 keeps the
                                checkbox snug to it. */}
                            {canReorder && <GripVertical className="w-3 h-3 shrink-0 -ml-1 -mr-1.5 text-[#555555] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />}
                            <input type="checkbox" checked={entry.done} onChange={e => requestMark(entry, e.target.checked)} className="cursor-pointer shrink-0" title={entry.done ? 'Mark not done' : 'Mark done'} />
                            <EntryTitle entry={entry} onOpenVideo={onOpenVideo} className={`text-xs min-w-0 truncate flex-1 ${entry.done ? 'text-gray-500 line-through' : 'text-gray-200'}`} />
                            {/* Everything after the name sits in fixed-width slots, kept even when empty (no priority, no date,
                                a video with no edit button), so the dates line up in one column down the list. */}
                            <span className="w-3 shrink-0 flex justify-center"><PriorityMark level={entry.priority} className="w-3 h-3" /></span>
                            {track.advanceMode !== 'completion' && (
                                <span className="w-[4.75rem] shrink-0 text-right text-[10px] text-gray-500 tabular-nums">{niceDate(entry.dueDate)}</span>
                            )}
                            {/* The row's buttons, as one group: In progress, then (for an editor) edit and remove. Each keeps its
                                slot when it doesn't apply, so the column lines up down the list. */}
                            <span className="shrink-0 flex items-center">
                                {/* In progress (started, not finished): lit in amber when on, shown on hover when off. The reader's
                                    own, like the checkbox, so it's there in a read-only workspace too. */}
                                {!entry.done ? (
                                    <button
                                        type="button"
                                        onClick={() => onProgress(entry, !entry.inProgress)}
                                        aria-pressed={entry.inProgress}
                                        title={entry.inProgress ? 'In progress (click to clear)' : 'Mark in progress'}
                                        className={`p-0.5 rounded transition-opacity cursor-pointer ${entry.inProgress ? 'text-amber-400' : 'text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                                    >
                                        <InProgressIcon className="w-3 h-3" />
                                    </button>
                                ) : <span className="w-4" aria-hidden />}
                                {/* A video's pencil edits its priority and description (one following a Drive's sequence has no
                                    row of its own to edit until it's marked). */}
                                {canEdit && (!entry.videoId || entry.id > 0 ? (
                                    <button onClick={() => onTask(entry)} className="p-0.5 text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer" title={entry.videoId ? 'Edit video' : 'Edit task'}>
                                        <Pencil className="w-3 h-3" />
                                    </button>
                                ) : <span className="w-4" aria-hidden />)}
                                {canEdit && !track.sourceDriveSequence && (
                                    <button onClick={() => onRemove(entry)} className="p-0.5 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer" title="Remove from track">
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </span>
                        </li>
                    ))}
                </ol>
                {track.sourceDriveSequence && (
                    <p className="text-[11px] text-gray-500 mt-2 px-1">
                        Follows {track.drive}'s {labels.aliasSequence.toLowerCase()}: Add or reorder videos there, and they show up here.
                    </p>
                )}
            </div>
            {/* Always in reach, however long the track is. */}
            {!track.sourceDriveSequence && canEdit && (
                <div className="shrink-0 px-2 pb-2 border-t border-[#222]">
                    <AddEntry onAddVideo={onAddVideo} onAddNote={onAddNote} onAddWorkbook={onAddWorkbook} onNewTask={() => onTask(null)} onNewFolder={onNewFolder} />
                </div>
            )}
            {marking && (
                <ConfirmDialog
                    title="Checking Future Due Date Action"
                    confirmLabel="Yes"
                    cancelLabel="No"
                    message={
                        <>
                            You are checking off "{marking.title}" for{" "}
                            {niceDate(marking.dueDate)}, which is a <strong>future due date</strong>.
                            <br /><br />
                            Are you sure you want to complete this action?
                        </>
                    }
                    onConfirm={confirmMark}
                    onCancel={() => setMarking(null)}
                />
            )}
        </div>
    );
}

/** What the lookup lists: a video of the library, or a note (the Notes section). */
interface Found { id: string; title: string; sub?: string | null; thumb?: string }

/** Adds a video from the library or a note (each looked up by what's typed, right here), or a task (in its own window:
 *  onNewTask), to the end of a track. The videos come in two groups, as the Tags dropdown's do (Essentials, then Custom):
 *  Pinned (what the reader is working on now, so most likely what's wanted), then All Videos, without the pinned ones
 *  again. */
export function AddEntry({ onAddVideo, onAddNote, onAddWorkbook, onNewTask, onNewFolder }: { onAddVideo: (videoId: string) => void; onAddNote?: (noteId: string) => void; onAddWorkbook?: (workbookId: string) => void; onNewTask: () => void; onNewFolder?: () => void }) {
    const [looking, setLooking] = useState<false | 'video' | 'note' | 'workbook'>(false);
    const [text, setText] = useState('');
    // null while a lookup is on its way. With nothing typed, the library's newest videos (as the link picker shows), or
    // the notes changed last.
    const [results, setResults] = useState<Found[] | null>(null);
    // The pinned videos that fit what's typed (videos only), listed first.
    const [pinned, setPinned] = useState<Found[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!looking) return;
        let cancelled = false;
        const query = text.trim();
        const find = (): Promise<Found[]> => looking === 'workbook'
            ? listWorkbooks().then(books => books
                .filter(b => b.noteIds.length > 0 && (!query || b.title.toLowerCase().includes(query.toLowerCase())))
                .slice(0, 8)
                .map(b => ({ id: b.id, title: b.title, sub: `${b.noteIds.length} ${b.noteIds.length === 1 ? 'note' : 'notes'}` })))
            : looking === 'note'
            ? listNotes().then(notes => notes
                .filter(n => !query || `${n.title}\n${n.body}`.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8)
                .map(n => ({ id: n.id, title: noteDisplayTitle(n), sub: n.shared ? 'Shared' : 'Personal' })))
            : (query ? searchLibrary(query, { limit: 8 }) : getSavedVideos(false, { limit: 8 }))
                .then(r => r.videos.map(v => ({ id: v.id, title: v.title, sub: v.author, thumb: v.thumbnail })));
        // The pins that fit what's typed (by title or creator), newest pin first. None for notes, or if they can't be read.
        const findPinned = (): Promise<Found[]> => looking !== 'video' ? Promise.resolve([])
            : listPins()
                .then(pins => pins
                    .filter(p => !query || `${p.title}\n${p.author}`.toLowerCase().includes(query.toLowerCase()))
                    .map(p => ({ id: p.videoId, title: p.title, sub: p.author, thumb: videoThumbnail(p.videoId) })))
                .catch(() => []);
        const timer = setTimeout(() => {
            Promise.all([find(), findPinned()])
                .then(([found, pins]) => {
                    if (cancelled) return;
                    // All Videos doesn't repeat what Pinned already lists.
                    const pinnedIds = new Set(pins.map(p => p.id));
                    setPinned(pins);
                    setResults(found.filter(f => !pinnedIds.has(f.id)));
                    setError(null);
                })
                .catch(e => { if (!cancelled) { setPinned([]); setResults([]); setError(String(e)); } });
        }, query ? 200 : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [looking, text]);

    const close = () => { setLooking(false); setText(''); setResults(null); setPinned([]); setError(null); };
    const pick = (id: string) => (looking === 'workbook' ? onAddWorkbook?.(id) : looking === 'note' ? onAddNote?.(id) : onAddVideo(id));

    // The suggestions float over the page (not in the panel's flow, where they'd sit below the fold): under the box, or
    // above it when there isn't room below, kept in place as the panel scrolls. Shown while the box has focus.
    const rowRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(true);
    const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
    const showing = looking && focused && (error !== null || results !== null);
    useLayoutEffect(() => {
        if (!showing) { setAt(null); return; }
        const place = () => {
            const r = rowRef.current?.getBoundingClientRect();
            if (!r) return;
            const room = 272;
            setAt(window.innerHeight - r.bottom >= room || r.top < room
                ? { left: r.left, width: r.width, top: r.bottom + 6 }
                : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6 });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
    }, [showing]);

    if (!looking) {
        return (
            <div className="mt-2">
                {/* One heading for the row, so each button only says what it adds. */}
                <div className="flex items-center gap-2 px-1 mb-1 select-none">
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-500">Add</span>
                    <span className="flex-1 h-px bg-[#272727]" />
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                <button
                    onClick={() => setLooking('video')}
                    title="Add a video from your library to the end of this track."
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer whitespace-nowrap"
                >
                    <VideoIcon className="w-3.5 h-3.5" /> Video
                </button>
                {onAddNote && (
                    <button
                        onClick={() => setLooking('note')}
                        title="Add one of your notes to the end of this track: A reading, a review or a write-up as a step of its own."
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer whitespace-nowrap"
                    >
                        <NotebookPen className="w-3.5 h-3.5" /> Note
                    </button>
                )}
                {onAddWorkbook && (
                    <button
                        onClick={() => setLooking('workbook')}
                        title="Add a workbook's notes to the end of this track, in the workbook's order: A page a step. Notes already on the track are left where they are."
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer whitespace-nowrap"
                    >
                        <BookOpenText className="w-3.5 h-3.5" /> Workbook
                    </button>
                )}
                <button
                    onClick={onNewTask}
                    title={'Add a step that isn\'t a video, like a reading or a problem set.\n\nIt can also be a break: A task called "Free day", "No video" or a holiday like "Fall Break" takes up a day on the schedule, so everything after it moves to the next day.'}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer whitespace-nowrap"
                >
                    <ListPlus className="w-3.5 h-3.5" /> Task
                </button>
                {onNewFolder && (
                    <button
                        onClick={onNewFolder}
                        title="Group several videos and tasks into one place: On a dated track, everything in a folder lands on the same day."
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer whitespace-nowrap"
                    >
                        <FolderPlus className="w-3.5 h-3.5" /> Folder
                    </button>
                )}
                </div>
            </div>
        );
    }
    return (
        <div className="mt-2">
            <div ref={rowRef} className="flex items-center gap-2">
                <input
                    autoFocus
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onContextMenu={handlePlainContextMenu}
                    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
                    placeholder={looking === 'workbook' ? 'Look up a workbook...' : looking === 'note' ? 'Look up a note...' : 'Look up a video in the library...'}
                    className="flex-1 bg-[#0f0f0f] border border-[#333] focus:border-[var(--k-accent)] outline-none rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
                <button onClick={close} className="p-1.5 text-gray-500 hover:text-white transition-colors cursor-pointer" title="Done adding"><X className="w-4 h-4" /></button>
            </div>
            {showing && at && createPortal(
                // Pressing in it keeps the box focused, so several videos can be added in a row.
                <div
                    onMouseDown={e => e.preventDefault()}
                    style={{ left: at.left, width: at.width, top: at.top, bottom: at.bottom }}
                    className="fixed z-[250] bg-[#0f0f0f] border border-[#272727] rounded-lg shadow-2xl shadow-black/60 overflow-hidden"
                >
                    {error ? (
                        <p className="px-3 py-2 text-[11px] text-red-400 break-words">{error}</p>
                    ) : results && results.length === 0 && pinned.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-gray-500">{looking === 'workbook' ? (text.trim() ? 'No workbooks match.' : 'No workbooks with notes in them yet.') : looking === 'note' ? (text.trim() ? 'No notes match.' : 'No notes yet.') : text.trim() ? 'No videos match.' : 'The library has no videos yet.'}</p>
                    ) : results && (() => {
                        const row = (v: Found) => (
                            <li key={v.id}>
                                <button
                                    onClick={() => { pick(v.id); close(); }}
                                    className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                                >
                                    {v.thumb ? <img src={v.thumb} alt="" className="w-12 h-7 object-cover rounded shrink-0" />
                                        : looking === 'workbook' ? <BookOpenText className="w-4 h-4 shrink-0 text-gray-500" />
                                        : looking === 'note' && <NotebookPen className="w-4 h-4 shrink-0 text-gray-500" />}
                                    <span className="text-sm text-gray-200 truncate">{v.title}</span>
                                    {v.sub && <span className="text-[11px] text-gray-500 truncate shrink-0 max-w-[30%]">{v.sub}</span>}
                                </button>
                            </li>
                        );
                        // A label with a rule running out to the right, as the Tags dropdown's groups have.
                        const heading = (label: string) => (
                            <li className="flex items-center gap-2 px-3 pt-2 pb-1 select-none" aria-hidden>
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#aaaaaa]">{label}</span>
                                <span className="flex-1 h-px bg-[#383838]" />
                            </li>
                        );
                        return (
                            <ul className="py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                {pinned.length > 0 && heading('Pinned')}
                                {pinned.map(row)}
                                {pinned.length > 0 && results.length > 0 && heading('All Videos')}
                                {results.map(row)}
                            </ul>
                        );
                    })()}
                </div>,
                document.body,
            )}
        </div>
    );
}
