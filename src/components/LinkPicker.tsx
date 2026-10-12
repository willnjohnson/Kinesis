import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { ArrowLeft, BookOpen, BookOpenText, FileText, GalleryVerticalEnd, HardDrive, ListOrdered, NotebookPen, Play, Search, Video as VideoIcon, X } from 'lucide-react';
import {
    decodeWdbs, encodeWdbs, getBiographies, getGlossaryTerms, getSavedVideos, getVideoPosition, getWdbsAliases, getWdbsTree, listDriveSequences, listNotes, listPins, listWorkbooks, searchLibrary, videoThumbnail,
    type WdbsNode,
} from '../api';
import { useFlags } from '../hooks/useFlags';
import { useWorkspace } from '../hooks/useWorkspace';
import { linkKindLabel } from '../lib/internal-links';
import { driveSegmentLabel } from '../lib/utils';
import { ALL_TERMS, studyDecks, studyTerms } from '../lib/glossary';
import { PlaylistThumb, sequenceName } from './SequenceCard';
import {
    buildLink, buildVideoLink, LINK_PICKER_EVENT, type LinkKind, type LinkPickerRequest,
} from '../lib/internal-links';
import { formatClock, parseClock } from '../lib/remark-timestamps';
import { backdropProps } from '../lib/backdrop';

interface Choice {
    key: string;
    label: string;
    sub?: string;
    thumb?: string;
    /** A sequence, drawn as a playlist: its first video's thumbnail with the video count on it. */
    playlist?: { videoId: string | null; count: number };
    /** The link's words when nothing is selected, where they aren't the row's name. */
    linkText?: string;
    /** The heading it's listed under, when the list is in groups (the videos: Pinned, then All Videos). */
    group?: string;
}

// Tab names come from linkKindLabel (the workspace's aliases).
const TABS: { kind: LinkKind; Icon: ElementType }[] = [
    { kind: 'glossary', Icon: BookOpen },
    { kind: 'bio', Icon: FileText },
    { kind: 'video', Icon: VideoIcon },
    { kind: 'drive', Icon: HardDrive },
    { kind: 'playlist', Icon: ListOrdered },
    { kind: 'note', Icon: NotebookPen },
    { kind: 'flashcards', Icon: GalleryVerticalEnd },
    { kind: 'workbook', Icon: BookOpenText },
];

const MAX_SHOWN = 200;

/** Marks a note's editor (the Notes section's). A video picked for it is asked about first: the whole video, or a moment
 *  in it. Notes cite moments; a summary or a definition mostly just points at a video. */
export const NOTE_EDITOR_ATTR = 'data-note-editor';

function flattenDrives(nodes: WdbsNode[], out: WdbsNode[] = []): WdbsNode[] {
    for (const n of nodes) {
        out.push(n);
        flattenDrives(n.children, out);
    }
    return out;
}

const matches = (query: string, ...fields: (string | null | undefined)[]) => {
    const q = query.trim().toLowerCase();
    return !q || fields.some(f => (f ?? '').toLowerCase().includes(q));
};

/**
 * The Ctrl+Shift+K pane: choose something in the app to link to (a glossary term, a channel's
 * biography, a saved video, a Drive or a note) and a link to it is written into the markdown being edited.
 * The editor shortcut only asks for it (lib/internal-links.ts's requestLinkPicker); this one
 * component, mounted once in App, answers for every editor.
 */
export function LinkPicker() {
    const { flags } = useFlags();
    const { labels } = useWorkspace();
    const [request, setRequest] = useState<LinkPickerRequest | null>(null);
    const [chosenTab, setChosenTab] = useState<LinkKind>('glossary');
    const [query, setQuery] = useState('');
    const [choices, setChoices] = useState<Choice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // A video picked for a note, waiting on "the whole video, or a moment in it?": the time typed, and where the reader
    // stopped watching it (offered as the moment, when there is one).
    const [timing, setTiming] = useState<Choice | null>(null);
    const [timeText, setTimeText] = useState('');
    const [stoppedAt, setStoppedAt] = useState<number | null>(null);
    const timeRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        setTimeText('');
        setStoppedAt(null);
        if (!timing) return;
        let live = true;
        getVideoPosition(timing.key).then(p => { if (live && p && p.seconds >= 1) setStoppedAt(Math.floor(p.seconds)); }).catch(() => {});
        setTimeout(() => timeRef.current?.focus(), 0);
        return () => { live = false; };
    }, [timing]);

    // Only what a DB owner has left switched on (see lib/flags.ts).
    const tabs = useMemo(() => TABS.filter(t => {
        if (t.kind === 'glossary' || t.kind === 'flashcards') return flags.showGlossary;
        if (t.kind === 'bio') return flags.showBiography;
        if (t.kind === 'drive') return flags.showDrive;
        if (t.kind === 'playlist') return flags.showDrive && flags.showSequences;
        if (t.kind === 'note' || t.kind === 'workbook') return flags.showNotes;
        return true;
    }), [flags.showGlossary, flags.showBiography, flags.showDrive, flags.showSequences, flags.showNotes]);

    useEffect(() => {
        const onRequest = (e: Event) => {
            const detail = (e as CustomEvent<LinkPickerRequest>).detail;
            setQuery('');
            setError(null);
            setChoices([]);
            setTiming(null);
            if (detail.tab) setChosenTab(detail.tab);
            setRequest(detail);
        };
        window.addEventListener(LINK_PICKER_EVENT, onRequest);
        return () => window.removeEventListener(LINK_PICKER_EVENT, onRequest);
    }, []);

    // The chosen tab, or the first available one when that one is hidden.
    const tab: LinkKind = tabs.some(t => t.kind === chosenTab) ? chosenTab : (tabs[0]?.kind ?? 'glossary');

    useEffect(() => {
        if (request && !timing) setTimeout(() => inputRef.current?.focus(), 0);
    }, [request, tab, timing]);

    // Loads what the current tab lists, narrowed by the search box. Videos are searched by the
    // backend (there can be thousands), so that tab waits a moment after typing.
    useEffect(() => {
        if (!request) return;
        let cancelled = false;
        const load = async (): Promise<Choice[]> => {
            switch (tab) {
                case 'glossary': {
                    const terms = await getGlossaryTerms();
                    // A link is by name alone, so a term with a definition per Drive is listed once
                    // (the first row's text; which Drive's opens is decided when the link is followed).
                    const seen = new Set<string>();
                    return terms
                        // Quick Tags have no definition, so there is nothing to open.
                        .filter(({ term, definition }) => definition.trim() !== '' && matches(query, term, definition))
                        .filter(({ term }) => !seen.has(term) && seen.add(term))
                        .map(({ term, definition }) => ({ key: term, label: term, sub: definition.replace(/\s+/g, ' ').slice(0, 90) }));
                }
                case 'bio': {
                    const bios = await getBiographies();
                    return bios
                        .filter(b => b.handle.trim() !== '' && matches(query, b.displayName, b.handle))
                        .map(b => ({
                            key: b.handle.replace(/^@/, ''),
                            label: b.displayName.trim() || b.handle,
                            sub: b.displayName.trim() ? b.handle : undefined,
                        }));
                }
                case 'video': {
                    // In two groups, as where a track's videos are added (calendar/TrackDetail.tsx): Pinned (what's being
                    // worked on now, so most likely what's wanted; the pins that fit what's typed, newest pin first), then
                    // All Videos, without the pinned ones again. With nothing pinned that fits, the list has no headings.
                    const opts = { limit: 30 };
                    const q = query.trim();
                    const [res, pins] = await Promise.all([
                        q ? searchLibrary(q, opts) : getSavedVideos(false, opts),
                        listPins().catch(() => []),
                    ]);
                    const pinned: Choice[] = pins
                        .filter(p => matches(query, p.title, p.author))
                        .map(p => ({ key: p.videoId, label: p.title, sub: p.author || undefined, thumb: videoThumbnail(p.videoId), group: 'Pinned' }));
                    const pinnedIds = new Set(pinned.map(p => p.key));
                    const rest: Choice[] = res.videos
                        .filter(v => !pinnedIds.has(v.id))
                        .map(v => ({ key: v.id, label: v.title, sub: v.author ?? undefined, thumb: v.thumbnail, group: pinned.length > 0 ? 'All Videos' : undefined }));
                    return [...pinned, ...rest];
                }
                case 'drive': {
                    const nodes = flattenDrives(await getWdbsTree());
                    return nodes
                        .map(n => ({ n, display: decodeWdbs(n.path) }))
                        .filter(({ n, display }) => matches(query, display, n.alias, n.segment))
                        .map(({ n, display }) => ({
                            key: n.path,
                            label: n.alias ?? driveSegmentLabel(display),
                            sub: `${display} · ${n.count} video${n.count === 1 ? '' : 's'}`,
                        }));
                }
                case 'playlist': {
                    // The key is the Drive's display path: the link opens whatever is first in its playlist at the time.
                    const sequences = await listDriveSequences();
                    const aliases = await getWdbsAliases(sequences.map(s => encodeWdbs(s.drive))).catch(() => ({} as Record<string, string>));
                    return sequences
                        .map(s => ({ s, alias: aliases[encodeWdbs(s.drive)] ?? null }))
                        .filter(({ s, alias }) => matches(query, s.drive, alias, s.firstTitle))
                        .map(({ s, alias }) => ({
                            key: s.drive,
                            label: sequenceName(s.drive, alias, labels.aliasSequence),
                            sub: `${s.drive} · ${s.count} video${s.count === 1 ? '' : 's'}`,
                            playlist: { videoId: s.firstVideoId, count: s.count },
                        }));
                }
                case 'flashcards': {
                    // A deck per Drive that has terms to study (its own and those beneath it), after every term at once.
                    // The link opens that Drive's flashcards as they are at the time.
                    const terms = await getGlossaryTerms();
                    const count = (n: number) => `${n} term${n === 1 ? '' : 's'}`;
                    const all = studyTerms(terms, ALL_TERMS).length;
                    return [
                        ...(all > 0 ? [{ key: ALL_TERMS, label: 'All Terms', sub: count(all), linkText: 'Flashcards' }] : []),
                        ...studyDecks(terms).map(d => ({ key: d.drive, label: d.drive, sub: count(d.count), linkText: `${driveSegmentLabel(d.drive)} Flashcards` })),
                    ].filter(c => matches(query, c.label));
                }
                case 'workbook': {
                    const books = await listWorkbooks();
                    return books
                        .filter(b => matches(query, b.title))
                        .map(b => ({ key: b.id, label: b.title, sub: `${b.shared ? 'Shared' : 'Personal'} · ${b.noteIds.length} note${b.noteIds.length === 1 ? '' : 's'}` }));
                }
                case 'note': {
                    // Shared and personal alike, the most recently changed first. A link to a personal note works only
                    // here: a Kinpak leaves the note out, and the link reads as its words there.
                    const notes = await listNotes();
                    return notes
                        .filter(n => matches(query, n.title, n.body))
                        .map(n => ({
                            key: n.id,
                            label: n.title.trim() || 'Untitled',
                            sub: `${n.shared ? 'Shared' : 'Personal'}${n.body.trim() ? ` · ${n.body.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
                        }));
                }
            }
        };
        const timer = setTimeout(() => {
            setLoading(true);
            load()
                .then(list => { if (!cancelled) { setChoices(list.slice(0, MAX_SHOWN)); setError(null); } })
                .catch(e => { if (!cancelled) { setChoices([]); setError(typeof e === 'string' ? e : e?.message ?? 'Failed to load.'); } })
                .finally(() => { if (!cancelled) setLoading(false); });
        }, tab === 'video' ? 200 : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [request, tab, query]);

    const close = useCallback(() => {
        const ta = request?.textarea;
        setRequest(null);
        // Give the editor back the cursor and selection it had.
        if (ta && request) setTimeout(() => { ta.focus(); ta.setSelectionRange(request.start, request.end); }, 0);
    }, [request]);

    // `at`: for a video, the moment the link starts at (seconds).
    const insert = (choice: Choice, at?: number) => {
        if (!request) return;
        const { textarea, start, end } = request;
        const selected = textarea.value.substring(start, end);
        const text = selected.trim() ? selected : choice.linkText ?? choice.label;
        let link = tab === 'video' ? buildVideoLink(text, choice.key, at) : buildLink(text, tab, choice.key);
        // A video or playlist with no text selected goes on a line of its own, where it shows as a card
        // (lib/remark-embeds.ts). Selected text is linked where it is, inline.
        if (!selected.trim() && (tab === 'video' || tab === 'playlist')) {
            const before = textarea.value.substring(0, start);
            const after = textarea.value.substring(end);
            if (before !== '' && !before.endsWith('\n')) link = '\n' + link;
            if (after !== '' && !after.startsWith('\n')) link = link + '\n';
        }
        setRequest(null);
        textarea.focus();
        textarea.setSelectionRange(start, end);
        // insertText keeps the editor's undo history and makes React see the change, like the other shortcuts.
        document.execCommand('insertText', false, link);
        // The caret goes after the link, ready to carry on typing.
        setTimeout(() => textarea.setSelectionRange(start + link.length, start + link.length), 0);
    };

    const choose = (choice: Choice) => {
        // In a note, a video is asked about first (see NOTE_EDITOR_ATTR).
        if (tab === 'video' && request?.textarea.hasAttribute(NOTE_EDITOR_ATTR)) setTiming(choice);
        else insert(choice);
    };
    const typedTime = timeText.trim() ? parseClock(timeText.trim()) : null;
    const addAtTypedTime = () => { if (timing && typedTime !== null) insert(timing, typedTime); };

    if (!request || tabs.length === 0) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-150" {...backdropProps(close)}>
            <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // Esc steps back from the "whole video or a moment?" question first.
                    if (e.key === 'Escape') { e.preventDefault(); if (timing) setTiming(null); else close(); }
                    if (e.key === 'Enter' && !timing && choices[0] && document.activeElement === inputRef.current) { e.preventDefault(); choose(choices[0]); }
                }}
                className="bg-[#0f0f0f] border border-[#303030] rounded-2xl w-full max-w-2xl h-[70vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            >
                <div className="px-5 py-3 border-b border-[#303030] flex items-center justify-between bg-[#141414]">
                    <h2 className="text-sm font-bold text-white">Link to</h2>
                    <button onClick={close} aria-label="Close" className="text-gray-500 hover:text-white transition-colors cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {timing ? (
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 custom-scrollbar">
                        <button onClick={() => setTiming(null)} className="flex items-center gap-1.5 text-[11px] font-semibold text-[#888888] hover:text-white transition-colors cursor-pointer">
                            <ArrowLeft className="w-3.5 h-3.5" /> Choose another video
                        </button>
                        <div className="mt-3 flex items-center gap-3">
                            {timing.thumb && <img src={timing.thumb} alt="" className="w-24 h-14 object-cover rounded-md shrink-0 bg-[#272727]" />}
                            <span className="min-w-0 flex flex-col">
                                <span className="text-sm font-semibold text-white line-clamp-2">{timing.label}</span>
                                {timing.sub && <span className="text-[11px] text-[#777777] truncate">{timing.sub}</span>}
                            </span>
                        </div>
                        <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-[#777777]">Link to</p>
                        <button
                            onClick={() => insert(timing)}
                            className="mt-2 w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border border-[#303030] hover:border-[#505050] hover:bg-white/5 transition-colors cursor-pointer"
                        >
                            <VideoIcon className="w-4 h-4 shrink-0 text-[#aaaaaa]" />
                            <span className="flex flex-col">
                                <span className="text-sm text-white">The whole video</span>
                                <span className="text-[11px] text-[#777777]">It opens from the start.</span>
                            </span>
                        </button>
                        <div className="mt-2 px-3 py-2.5 rounded-lg border border-[#303030]">
                            <div className="flex items-center gap-3">
                                <Play className="w-4 h-4 shrink-0 text-[#aaaaaa]" />
                                <span className="flex flex-col">
                                    <span className="text-sm text-white">A moment in it</span>
                                    <span className="text-[11px] text-[#777777]">It opens at the time you give, like 12:34 or 1:02:03.</span>
                                </span>
                            </div>
                            <div className="mt-2.5 flex items-center gap-2 pl-7">
                                <input
                                    ref={timeRef}
                                    value={timeText}
                                    onChange={e => setTimeText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addAtTypedTime(); } }}
                                    placeholder="12:34"
                                    inputMode="numeric"
                                    className="w-24 bg-[#1a1a1a] border border-[#333] focus:border-red-600/50 outline-none rounded-lg px-3 py-1.5 text-sm text-white tabular-nums placeholder-[#555]"
                                />
                                <button
                                    onClick={addAtTypedTime}
                                    disabled={typedTime === null}
                                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default"
                                >
                                    Add at this time
                                </button>
                                {stoppedAt !== null && (
                                    <button
                                        onClick={() => insert(timing, stoppedAt)}
                                        title="Where you stopped watching this video"
                                        className="ml-auto px-2 py-1.5 rounded-lg border border-[#333] hover:border-[#505050] text-[11px] font-semibold text-[#aaaaaa] hover:text-white cursor-pointer whitespace-nowrap"
                                    >
                                        Where you stopped: {formatClock(stoppedAt)}
                                    </button>
                                )}
                            </div>
                            {timeText.trim() !== '' && typedTime === null && <p className="mt-1.5 pl-7 text-[11px] text-red-400">That isn't a time like 12:34.</p>}
                        </div>
                    </div>
                ) : (<>
                <div className="px-5 pt-4 flex items-center gap-4">
                    {tabs.map(({ kind, Icon }) => (
                        <button
                            key={kind}
                            onClick={() => setChosenTab(kind)}
                            className={`flex items-center gap-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative ${tab === kind ? 'text-white' : 'text-[#666666] hover:text-[#aaaaaa]'}`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {linkKindLabel(kind, labels)}
                            {tab === kind && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600" />}
                        </button>
                    ))}
                </div>

                <div className="px-5 pt-3">
                    <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#333] focus-within:border-red-600/50 rounded-lg px-3 transition-colors">
                        <Search className="w-3.5 h-3.5 text-[#666666] shrink-0" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={`${labels.aliasSearch} ${linkKindLabel(tab, labels).toLowerCase()}`}
                            className="flex-1 bg-transparent outline-none py-2 text-sm text-white placeholder-[#555]"
                        />
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 custom-scrollbar">
                    {error ? (
                        <p className="text-xs text-red-400 px-2">{error}</p>
                    ) : choices.length === 0 ? (
                        <p className="text-[11px] text-[#666666] italic px-2 py-2">{loading ? 'Loading...' : 'Nothing found.'}</p>
                    ) : (
                        <ul className="space-y-0.5">
                            {choices.map((choice, i) => (
                                <li key={choice.key}>
                                    {/* A group's heading, over its first row. */}
                                    {choice.group && choice.group !== choices[i - 1]?.group && (
                                        <div className={`flex items-center gap-2 px-2 pb-1 select-none ${i > 0 ? 'pt-3' : 'pt-0.5'}`} aria-hidden>
                                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#aaaaaa]">{choice.group}</span>
                                            <span className="flex-1 h-px bg-[#383838]" />
                                        </div>
                                    )}
                                    <button
                                        onClick={() => choose(choice)}
                                        className="w-full flex items-center gap-3 text-left px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                        {choice.thumb && (
                                            <img src={choice.thumb} alt="" loading="lazy" className="w-16 h-10 object-cover rounded-md shrink-0 bg-[#272727]" />
                                        )}
                                        {choice.playlist && <PlaylistThumb videoId={choice.playlist.videoId} count={choice.playlist.count} className="w-20 aspect-video rounded-md" />}
                                        <span className="min-w-0 flex flex-col">
                                            <span className="text-sm text-white truncate">{choice.label}</span>
                                            {choice.sub && <span className="text-[11px] text-[#777777] truncate">{choice.sub}</span>}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                </>)}
            </div>
        </div>
    );
}
