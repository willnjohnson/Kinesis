import { useEffect, useRef, useState } from 'react';
import { BookOpenText, CalendarPlus, FileArchive, FileDown, GripVertical, MoreVertical, NotebookPen, Pencil, Plus, Trash2, User, Users, X } from 'lucide-react';
import {
    addCalendarNoteEntry, addCalendarWorkbook, createWorkbook, deleteWorkbook, removeNoteFromWorkbook, renameWorkbook, reorderWorkbook, setWorkbookShared,
    type CalendarTrackSummary, type Note, type Workbook,
} from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { handlePlainContextMenu } from '../lib/markdown-editor';
import { exportNote, exportWorkbook } from '../lib/note-export';
import { noteDisplayTitle } from '../lib/notes';
import { normalizeText } from '../lib/utils';
import { errorText } from '../lib/error-text';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { editedAndCreated, HoverDates } from './HoverDates';
import type { NotificationContent } from './Notification';



const INPUT = 'w-full bg-[#121212] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600';
const ICON_BUTTON = 'p-1 rounded-md text-gray-500 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-500';

/**
 * The Notes panel's other side: workbooks, which are notes put in an order to be read through a page at a time. With
 * none open, the list of them (and New Workbook at the foot, as New Note is). With one open, its notes in order, each
 * numbered: click one to read it, drag it by its grip to another place, or use its X to take it out (the note itself
 * stays). A workbook is renamed, shared or made personal, and deleted from its heading.
 */
export function WorkbooksPanel({ books, notes, searchQuery, openBookId, openNoteId, canShare, tracks, onWantTracks, onOpenBook, onOpenNote, onNotify }: {
    books: Workbook[];
    /** The header search bar's text, as the notes list takes it: plain words, or `title_search:` and words. It narrows
     *  what's listed here: the workbooks (by their name, or by a note in them), or the open workbook's notes. */
    searchQuery: string;
    notes: Note[];
    openBookId: string | null;
    openNoteId: string | null;
    /** Whether this reader can make shared things here (the workspace's rule for shared notes). */
    canShare: boolean;
    /** The Calendar tracks a note can be added to, for the right-click menus (null where the Calendar isn't to be
     *  added to: it's hidden, or the workspace is read-only). `onWantTracks` asks for them afresh, as a menu opens. */
    tracks: CalendarTrackSummary[] | null;
    onWantTracks: () => void;
    onOpenBook: (id: string | null) => void;
    onOpenNote: (id: string) => void;
    onNotify: (n: NotificationContent) => void;
}) {
    const book = books.find(b => b.id === openBookId) ?? null;
    const [naming, setNaming] = useState<{ id: string | null; text: string } | null>(null);
    const { labels } = useWorkspace();
    const [toDelete, setToDelete] = useState<Workbook | null>(null);
    // The right-click menu: for a workbook in the list, or for a page (a note, by its place) of the open one.
    const [menu, setMenu] = useState<{ x: number; y: number; book: Workbook; page: number | null } | null>(null);
    const openMenu = (e: React.MouseEvent, b: Workbook, page: number | null) => {
        e.preventDefault();
        e.stopPropagation();
        onWantTracks();
        setMenu({ x: e.clientX, y: e.clientY, book: b, page });
    };
    const [drag, setDrag] = useState<{ from: number; gap: number } | null>(null);
    // A workbook's Personal / Shared was clicked (its button, or its menu): asked about first, since its notes go
    // with it.
    const [confirmShare, setConfirmShare] = useState<Workbook | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (naming) setTimeout(() => nameRef.current?.select(), 0); }, [naming?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const failed = (e: unknown) => onNotify({ message: errorText(e), type: 'error' });
    // The filter. A note fits by its title, and by its text too unless the bar is on titles only. A workbook fits by
    // its own name, or (titles-only aside) by holding a note that fits.
    const titlesOnly = searchQuery.includes('title_search:');
    const q = normalizeText(searchQuery.replace(/title_search:/g, '').replace(/"/g, '').trim());
    const noteFits = (id: string) => {
        if (!q) return true;
        const n = notes.find(x => x.id === id);
        return !!n && normalizeText(titlesOnly ? noteDisplayTitle(n) : `${noteDisplayTitle(n)}
${n.body}`).includes(q);
    };
    const shownBooks = !q ? books : books.filter(b => normalizeText(b.title).includes(q) || (!titlesOnly && b.noteIds.some(noteFits)));
    const canChange = (b: Workbook) => !b.shared || canShare;

    const saveName = async () => {
        if (!naming) return;
        const text = naming.text.trim();
        setNaming(null);
        if (!text) return;
        try {
            if (naming.id) await renameWorkbook(naming.id, text);
            else onOpenBook((await createWorkbook(false, text)).id);
        } catch (e) { failed(e); }
    };
    const nameBox = naming && (
        <input
            ref={nameRef}
            autoFocus
            value={naming.text}
            onChange={e => setNaming({ ...naming, text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } else if (e.key === 'Escape') setNaming(null); }}
            onBlur={() => void saveName()}
            onContextMenu={handlePlainContextMenu}
            maxLength={120}
            placeholder="Name the workbook"
            className={INPUT}
        />
    );
    const confirmDelete = toDelete && (
        <ConfirmDialog
            message={`Delete the workbook "${toDelete.title}"? Its ${toDelete.noteIds.length === 1 ? 'note stays' : 'notes stay'}: Only the workbook goes, and links to it become plain words.`}
            onConfirm={() => {
                const gone = toDelete;
                setToDelete(null);
                deleteWorkbook(gone.id).then(() => { if (openBookId === gone.id) onOpenBook(null); }).catch(failed);
            }}
            onCancel={() => setToDelete(null)}
        />
    );

    // Shared or personal: straight away when it holds nothing, asked about first when notes go with it.
    const askShare = (b: Workbook) => (b.noteIds.length === 0 ? void setWorkbookShared(b.id, !b.shared).catch(failed) : setConfirmShare(b));
    const shareDialog = confirmShare && (() => {
        // A workbook and its notes change together: a shared workbook holds shared notes only, so sharing it shares
        // the notes that aren't yet; and making it personal takes its notes back with it. One step in the database:
        // all of it, or (if something fails) none.
        const b = confirmShare;
        const toShared = !b.shared;
        const moving = b.noteIds.filter(id => { const n = notes.find(x => x.id === id); return n ? n.shared !== toShared : false; });
        const count = `${moving.length} ${moving.length === 1 ? 'note' : 'notes'}`;
        const run = async () => {
            setConfirmShare(null);
            try {
                await setWorkbookShared(b.id, toShared, true);
                onNotify({ message: toShared ? `"${b.title}" and its notes are shared` : `"${b.title}" and its notes are personal`, type: 'success' });
            } catch (e) { failed(e); }
        };
        return (
            <ConfirmDialog
                title={toShared ? 'Share This Workbook?' : 'Make This Workbook Personal?'}
                confirmLabel={toShared ? 'Share All' : 'Make All Personal'}
                message={toShared
                    ? `Sharing "${b.title}" shares its notes too${moving.length > 0 ? `: ${count} that ${moving.length === 1 ? 'is' : 'are'} personal now will become shared` : ' (they already are)'}. Shared notes and workbooks travel with the workspace: Anyone you hand it to (a Kinpak) gets them.

You can make them personal again later.`
                    : `Making "${b.title}" personal makes its notes personal too${moving.length > 0 ? `: ${count} will stop being shared` : ''}. A note that's also in another shared workbook will drop out of that one.

You can share them again later.`}
                onConfirm={() => void run()}
                onCancel={() => setConfirmShare(null)}
            />
        );
    })();

    // The tracks a menu offers: the ones that keep their own list (not one following a Drive's sequence).
    const usable = (tracks ?? []).filter(t => !t.track.sourceDriveSequence && !t.track.archived);
    const toTracks = (add: (trackId: number) => Promise<string>): ContextMenuItem[] => usable.length === 0
        ? [{ label: 'No tracks to add to', disabled: true, onClick: () => {} }]
        : usable.map(t => ({
            label: t.track.name,
            onClick: () => { add(t.track.id).then(what => onNotify({ message: `${what} "${t.track.name}"`, type: 'success' })).catch(failed); },
        }));
    const steps = (n: number) => (n === 0 ? 'Nothing new to add to' : `${n} ${n === 1 ? 'note' : 'notes'} added to`);
    const menuItems = (b: Workbook, page: number | null): ContextMenuItem[] => {
        const calendar = `Add to ${labels.aliasCalendar}`;
        if (page !== null) {
            const noteId = b.noteIds[page];
            const pageNote = notes.find(n => n.id === noteId);
            return [
                { label: 'Open', icon: NotebookPen, onClick: () => onOpenNote(noteId) },
                ...(tracks ? [
                    // This page alone, as a step; or this page and every one after it, a step each, in the
                    // workbook's order (the pages before it are left out).
                    { label: `${labels.aliasCalendar}: This Page`, icon: CalendarPlus, divider: true, onClick: () => {}, submenu: toTracks(id => addCalendarNoteEntry(id, noteId).then(() => 'Added to')) },
                    { label: `${labels.aliasCalendar}: From Here On`, icon: CalendarPlus, onClick: () => {}, disabled: page === b.noteIds.length - 1, submenu: page === b.noteIds.length - 1 ? undefined : toTracks(id => addCalendarWorkbook(id, b.id, page + 1).then(steps)) },
                ] : []),
                ...(pageNote ? [{
                    label: 'Export Note as Markdown', icon: FileDown, divider: true,
                    onClick: () => {
                        exportNote(pageNote)
                            .then(path => { if (path) onNotify({ message: `Saved "${noteDisplayTitle(pageNote)}" to ${path}`, type: 'success' }); })
                            .catch(e => onNotify({ message: `Couldn't export the note: ${errorText(e)}`, type: 'error' }));
                    },
                }] : []),
                ...(canChange(b) ? [{ label: 'Take Out of Workbook', icon: X, divider: true, onClick: () => { removeNoteFromWorkbook(b.id, noteId).catch(failed); } }] : []),
            ];
        }
        // Its notes that are there to write (one that's gone isn't).
        const held = b.noteIds.filter(id => notes.some(n => n.id === id)).length;
        return [
            { label: 'Open', icon: BookOpenText, onClick: () => onOpenBook(b.id) },
            { label: 'Rename', icon: Pencil, disabled: !canChange(b), onClick: () => setNaming({ id: b.id, text: b.title }) },
            { label: b.shared ? 'Make Personal' : 'Share', icon: b.shared ? User : Users, disabled: !canShare, onClick: () => askShare(b) },
            ...(tracks ? [{ label: calendar, icon: CalendarPlus, disabled: b.noteIds.length === 0, onClick: () => {}, submenu: b.noteIds.length === 0 ? undefined : toTracks(id => addCalendarWorkbook(id, b.id).then(steps)) }] : []),
            // A ZIP of its notes as Markdown files, numbered in its order (lib/note-export.ts).
            {
                label: 'Export Workbook as ZIP', icon: FileArchive, divider: true, disabled: held === 0,
                onClick: () => {
                    exportWorkbook(b, notes)
                        .then(path => { if (path) onNotify({ message: `Saved "${b.title}" (${held} ${held === 1 ? 'note' : 'notes'}) to ${path}`, type: 'success' }); })
                        .catch(e => onNotify({ message: `Couldn't export the workbook: ${errorText(e)}`, type: 'error' }));
                },
            },
            { label: 'Delete Workbook', icon: Trash2, danger: true, divider: true, disabled: !canChange(b), onClick: () => setToDelete(b) },
        ];
    };
    const menuBox = menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.book, menu.page)} onClose={() => setMenu(null)} />;

    if (!book) {
        return (
            <>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#121212] rounded-xl border border-[#272727] p-1.5 mb-2">
                    {books.length === 0 && !naming ? (
                        <p className="px-3 py-3 text-xs text-gray-500 leading-relaxed">No workbooks yet. A workbook puts notes in an order of your choosing, to read through a page at a time.</p>
                    ) : shownBooks.length === 0 && !naming ? (
                        <p className="px-3 py-3 text-xs text-gray-500 leading-relaxed">No workbooks match your search.</p>
                    ) : shownBooks.map(b => {
                        const Mark = b.shared ? Users : User;
                        if (naming?.id === b.id) return <div key={b.id} className="p-1">{nameBox}</div>;
                        return (
                            // Resting the pointer on it says when it was last edited and when it was made.
                            <HoverDates key={b.id} title={b.title} rows={editedAndCreated(b)}>{hover => (
                            <div {...hover} role="button" tabIndex={0} onClick={() => onOpenBook(b.id)} onKeyDown={e => { if (e.key === 'Enter') onOpenBook(b.id); }} onContextMenu={e => openMenu(e, b, null)} className="group w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-[#1e1e1e] transition-colors cursor-pointer">
                                <BookOpenText className="w-4 h-4 shrink-0 text-[var(--k-accent)]" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-white truncate">{b.title}</span>
                                    <span className="block text-[11px] text-gray-500">{b.noteIds.length} {b.noteIds.length === 1 ? 'note' : 'notes'}</span>
                                </span>
                                <Mark className="w-3 h-3 shrink-0 text-gray-500" aria-label={b.shared ? 'Shared' : 'Personal'} />
                                <button type="button" onClick={e => { e.stopPropagation(); openMenu(e, b, null); }} className="shrink-0 p-1 rounded text-gray-500 transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="More actions">
                                    <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            )}</HoverDates>
                        );
                    })}
                    {naming?.id === null && <div className="p-1">{nameBox}</div>}
                </div>
                <div className="shrink-0 mb-2">
                    <button
                        onClick={() => setNaming({ id: null, text: '' })}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-bold transition-all cursor-pointer bg-[#121212] border-[#404040] text-gray-400 hover:text-white hover:border-[#505050]"
                        title="Start a workbook (personal: Only you have it, until you share it)"
                    >
                        <Plus className="w-3.5 h-3.5" /> New Workbook
                    </button>
                </div>
                {confirmDelete}
                {shareDialog}
                {menuBox}
            </>
        );
    }

    const titleOf = (id: string) => { const n = notes.find(x => x.id === id); return n ? noteDisplayTitle(n) : 'Untitled'; };
    // Dragging a note by its grip: where it's from, and the gap it would land in (0: before the first, n: after the
    // last), found from the pointer against the rows' middles. Done with the pointer, not HTML drag-and-drop (which the
    // app's window takes for files dropped on it).
    const startDrag = (e: React.PointerEvent, from: number) => {
        e.preventDefault();
        const gapAt = (y: number) => {
            const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
            const below = rows.findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
            return below === -1 ? rows.length : below;
        };
        setDrag({ from, gap: gapAt(e.clientY) });
        const onMove = (m: PointerEvent) => setDrag({ from, gap: gapAt(m.clientY) });
        const onUp = (u: PointerEvent) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setDrag(null);
            const gap = gapAt(u.clientY);
            // The gap just before or just after itself is where it already is.
            if (gap === from || gap === from + 1) return;
            const order = [...book.noteIds];
            const [id] = order.splice(from, 1);
            order.splice(gap > from ? gap - 1 : gap, 0, id);
            reorderWorkbook(book.id, order).catch(failed);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    const editable = canChange(book);
    return (
        <>
            <div className="shrink-0 mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#888888] min-w-0">
                    <button type="button" onClick={() => onOpenBook(null)} className="hover:text-white transition-colors cursor-pointer shrink-0">Workbooks</button>
                    <span className="shrink-0">/</span>
                    {!naming?.id ? (
                        <span className="min-w-0 truncate text-white" title={book.title}>{book.title}</span>
                    ) : (
                        <div className="flex-1 min-w-0">{nameBox}</div>
                    )}
                    {!naming?.id && editable && (
                        <>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setNaming({ id: book.id, text: book.title })} className={`${ICON_BUTTON} shrink-0`} title="Rename this workbook"><Pencil className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => setToDelete(book)} className={`${ICON_BUTTON} hover:text-red-400`} title="Delete this workbook (its notes stay)"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>
                    )}
                </div>

                <button
                    type="button"
                    disabled={!canShare}
                    onClick={() => askShare(book)}
                    title={!canShare ? (book.shared ? "A shared workbook: This workspace doesn't let you change shared ones" : 'Personal: Only you have it')
                        : book.shared ? 'Shared: It travels with the workspace, and holds shared notes only. Click to make it, and its notes, personal again'
                        : 'Personal: Only you have it. Click to share it, and its notes with it'}
                    className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#333] text-[11px] font-semibold text-gray-300 hover:text-white hover:border-[#505050] transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-gray-300 disabled:hover:border-[#333]"
                >
                    {book.shared ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {book.shared ? 'Shared' : 'Personal'}
                </button>
            </div>
            <div ref={listRef} className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#121212] rounded-xl border border-[#272727] p-1.5 mb-2 ${drag ? 'select-none cursor-grabbing' : ''}`}>
                {book.noteIds.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-gray-500 leading-relaxed">Nothing in it yet. Open a note and use <span className="text-gray-300">Add to Workbook</span> on its page.</p>
                ) : !book.noteIds.some(noteFits) ? (
                    <p className="px-3 py-3 text-xs text-gray-500 leading-relaxed">None of its notes match your search.</p>
                ) : book.noteIds.map((id, i) => {
                    // Filtered, a note keeps its number in the workbook; the ones that don't fit are just not listed.
                    if (!noteFits(id)) return null;
                    const open = id === openNoteId;
                    const note = notes.find(x => x.id === id);
                    return (
                        <HoverDates key={id} title={titleOf(id)} rows={note ? editedAndCreated(note) : []}>{hover => (
                        <div
                            // While a note is dragged to another place, no card.
                            {...(drag ? {} : hover)}
                            data-row
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenNote(id)}
                            onKeyDown={e => { if (e.key === 'Enter') onOpenNote(id); }}
                            onContextMenu={e => openMenu(e, book, i)}
                            className={`group relative flex items-center gap-1.5 rounded-lg pl-1 pr-1.5 py-2 cursor-pointer transition-colors ${open ? 'bg-[var(--k-accent)]/10' : 'hover:bg-[#1e1e1e]'} ${drag?.from === i ? 'opacity-40' : ''}`}
                        >
                            {/* Where the note being dragged would land: a line in the gap above this row, or under the last. */}
                            {drag && drag.gap === i && drag.gap !== drag.from && drag.gap !== drag.from + 1 && <span className="absolute left-1 right-1 -top-px h-0.5 rounded bg-[var(--k-accent)]" />}
                            {drag && i === book.noteIds.length - 1 && drag.gap === book.noteIds.length && drag.from !== i && <span className="absolute left-1 right-1 -bottom-px h-0.5 rounded bg-[var(--k-accent)]" />}
                            {editable && !q ? (
                                <span
                                    onPointerDown={e => startDrag(e, i)}
                                    onClick={e => e.stopPropagation()}
                                    title="Drag to another place in the workbook"
                                    className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 cursor-grab touch-none"
                                >
                                    <GripVertical className="w-3.5 h-3.5" />
                                </span>
                            ) : <span className="w-[18px] shrink-0" />}
                            <span className="w-5 shrink-0 text-[11px] font-semibold text-gray-500 tabular-nums text-right">{i + 1}</span>
                            <span className={`min-w-0 flex-1 truncate text-sm ${open ? 'text-white font-semibold' : 'text-gray-200'}`}>{titleOf(id)}</span>
                            <span className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        <button type="button" onClick={e => { e.stopPropagation(); openMenu(e, book, i); }} className={ICON_BUTTON} title="More actions"><MoreVertical className="w-3.5 h-3.5" /></button>
                                        {editable && (
                                            <button type="button" onClick={() => removeNoteFromWorkbook(book.id, id).catch(failed)} className={ICON_BUTTON} title="Take it out of this workbook (the note stays)"><X className="w-3 h-3" /></button>
                                        )}
                                    </span>
                        </div>
                        )}</HoverDates>
                    );
                })}
            </div>
            {confirmDelete}
            {shareDialog}
            {menuBox}
        </>
    );
}
