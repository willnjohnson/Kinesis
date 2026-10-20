import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { CODE_HIGHLIGHT } from '../lib/code-highlight';
import remarkGfm from 'remark-gfm';
import {
    ArrowDown, ArrowUp, BookOpenText, Calendar, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Eye, EyeOff, Feather, FileDown, GalleryVerticalEnd, LayoutTemplate, Library, MessageCircleQuestionMark, MoreVertical, NotebookPen, Pencil, Play, Plus, Quote as QuoteIcon, Search, Trash2, Type, User, Users, Video as VideoIcon, X,
} from 'lucide-react';
import {
    addCalendarNoteEntry, addNoteToWorkbook, calendarToday, createNote, deleteNote, getNote, getVideoCard, getWdbsRoots, listCalendarTracks, listNotes, listWorkbooks,
    NOTES_CHANGED_EVENT, removeNoteFromWorkbook, WORKBOOKS_CHANGED_EVENT, type Workbook,
    setNoteShared, trashDiscard, trashRestore, updateNote,
    type CalendarTrackSummary, type Note, type WdbsRoot, type DisplaySettings,
} from '../api';
import { getThemeCssVariables, resolveContentTheme, type Theme } from '../lib/themes';
import { useFlags } from '../hooks/useFlags';
import { useWorkspace } from '../hooks/useWorkspace';
import { ALL_TERMS, driveCovers } from '../lib/glossary';
import { foldVideoLinkTimes, markdownUrlTransform, openInternalLink, parseInternalHref } from '../lib/internal-links';
import { handleMarkdownContextMenu, handleMarkdownKeyDown, handlePlainContextMenu } from '../lib/markdown-editor';
import {
    citationCount, joinParagraphs, NOTE_APPEND_EVENT, OPEN_WORKBOOK_EVENT, takeRequestedWorkbook, noteDisplayTitle, noteSnippet, noteSources, setActiveNoteId, THOUGHT_MARK,
    getActiveNoteId, wordCount, type NoteAppendRequest,
} from '../lib/notes';
import { exportNote } from '../lib/note-export';
import { NOTE_MATH_REHYPE, NOTE_MATH_REMARK } from '../lib/note-math';
import { BUILT_IN_TEMPLATES, deleteNoteTemplate, fillTemplate, isUntouchedTemplate, loadNoteTemplates, MAX_TEMPLATE_NAME, saveNoteTemplate, type NoteTemplate } from '../lib/note-templates';
import { remarkEmbeds } from '../lib/remark-embeds';
import { QA_ANSWER_CLASS, QA_QUESTION_CLASS, remarkQa } from '../lib/remark-qa';
import { remarkHighlight } from '../lib/remark-highlight';
import { remarkCallouts } from '../lib/remark-callouts';
import { formatClock, remarkTimestamps } from '../lib/remark-timestamps';
import { normalizeText } from '../lib/utils';
import { BacklinksList } from './BacklinksList';
import { NOTE_EDITOR_ATTR } from './LinkPicker';
import { FindMirror, useNoteFind } from './NoteFind';
import { editedAndCreated, HoverDates } from './HoverDates';
import { FindReplacePanel } from './sidebar/FindReplacePanel';
import { MAKE_TERM_EVENT, MakeTermModal, type MakeTermRequest } from './MakeTermModal';
import { NOTE_TERMS_ATTR } from './MarkdownContextMenu';
import { BottomBar } from './BottomBar';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DriveTreeList, driveLabel, useDismiss } from './DriveTreeList';
import { MarkdownLink } from './MarkdownLink';
import { MENTIONS_ATTR } from './MentionGhost';
import type { NotificationContent } from './Notification';
import { TrashChip } from './TrashChip';
import { WorkbooksPanel } from './WorkbooksPanel';
import { errorText } from '../lib/error-text';
import { Segmented } from './ui/Segmented';

/** The page width (px) under which the note's tools are drawn as icons alone. */
const COMPACT_TOOLS_BELOW = 660;

/** Where the reader's Write / Read choice is kept (localStorage). */
const MODE_KEY = 'kinesis.notes.mode';

/** The Drive filter value that shows notes filed under no Drive (an empty string is "All Drives"). */
const UNASSIGNED = '__unassigned__';

/** What's being written: the open note's fields as they are on screen (saved shortly after typing stops). */
interface Draft {
    id: string;
    title: string;
    body: string;
    drives: string[];
    shared: boolean;
}

const draftOf = (n: Note): Draft => ({ id: n.id, title: n.title, body: n.body, drives: n.drives, shared: n.shared });
const sameContent = (a: Draft, b: Draft) => a.title === b.title && a.body === b.body && a.drives.join('\n') === b.drives.join('\n');

/** How long after the last keystroke a note is saved. */
const SAVE_AFTER_MS = 600;

/** "Just now", "5 min ago", "Yesterday", "Oct 3" (and the year, when it isn't this one). */
function whenLabel(iso: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const minutes = Math.round((Date.now() - at.getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const today = new Date();
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
        - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
    if (days === 0) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    return at.toLocaleDateString(undefined, at.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── A citation, drawn as a card ──────────────────────────────────────────────

interface HastNode { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] }

const textOf = (n: HastNode): string => n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join('');

/** A quote's source, when its last paragraph is "— " and a video link (lib/notes.ts's buildCitation), or "— Name" as
    *  plain text (a quote attributed to someone). `own`: the words are the reader's thought about that moment, not the
    *  video's ("— on " and the link, buildMomentNote). */
function citationSource(node: HastNode | undefined): { videoId?: string; at?: number; title: string; attribution: string; own: boolean } | null {
    const blocks = (node?.children ?? []).filter(c => c.type === 'element');
    const last = blocks[blocks.length - 1];
    if (!last || last.tagName !== 'p' || blocks.length < 2) return null;
    const parts = (last.children ?? []).filter(c => !(c.type === 'text' && !(c.value ?? '').trim()));
    // "— " or "— <thought>" followed by a video link.
    if (parts.length === 2 && parts[0].type === 'text' && parts[1].tagName === 'a') {
        const lead = /^\s*—\s*(\S+)?\s*$/.exec(parts[0].value ?? '');
        if (lead && (lead[1] === undefined || lead[1] === THOUGHT_MARK)) {
            const target = parseInternalHref(String(parts[1].properties?.href ?? ''));
            if (target && target.kind === 'video') {
                return { videoId: target.key, at: target.at, title: textOf(parts[1]).trim() || target.key, attribution: '', own: lead[1] !== undefined };
            }
        }
    }
    // "— Name" as plain text: a quote attributed to someone, not a moment in a video.
    if (parts.length === 1 && parts[0].type === 'text') {
        const lead = /^\s*—\s*(.+)$/.exec(parts[0].value ?? '');
        if (lead) return { title: '', attribution: lead[1].trim(), own: false };
    }
    return null;
}

/** A moment in a video, drawn the one way wherever a note shows one (a video on its line, a citation's source, the
    *  Sources column): a play mark and the time, on the accent's tint. */
function TimeTag({ at, className = '' }: { at: number; className?: string }) {
    return (
        <span className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold tabular-nums bg-[var(--k-accent)]/15 text-[var(--k-accent)] ${className}`}>
            <Play className="w-2.5 h-2.5 fill-current" />{formatClock(Math.floor(at))}
        </span>
    );
}

/** A video link without a moment, drawn the one way wherever a note shows one: a play mark and "Video", on the accent's tint. */
function VideoTag({ className = '' }: { className?: string }) {
    return (
        <span className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold tabular-nums bg-[var(--k-accent)]/15 text-[var(--k-accent)] ${className}`}>
            <Play className="w-2.5 h-2.5 fill-current" />Video
        </span>
    );
}

/** A callout that folds (written `> [!NOTE]-` or `> [!NOTE]+`, lib/remark-callouts.ts): its title is a button that
 *  shows or hides what's under it, with an arrow at its end that says which. It starts as it was written (folded for a
 *  minus, open for a plus); folding it while reading changes nothing in the note. */
function FoldingCallout({ startOpen, className, children }: { startOpen: boolean; className?: string; children?: ReactNode }) {
    const [open, setOpen] = useState(startOpen);
    // Its first part is the title line the plugin put there; the rest is what folds away.
    const parts = Children.toArray(children);
    const titleAt = parts.findIndex(p => isValidElement(p));
    const title = titleAt === -1 ? null : (parts[titleAt] as React.ReactElement<{ children?: ReactNode }>).props.children;
    return (
        // Drawn apart from a callout that doesn't fold (index.css's .k-callout-fold): a box with a line all round where
        // that one has a bar down its left, and its title a strip across the top, with the arrow that says which way
        // it is leading it.
        <blockquote className={`${className ?? ''} k-callout-fold`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                title={open ? 'Fold this away' : 'Show what it holds'}
                className="k-callout-title w-full text-left cursor-pointer"
            >
                {/* Before the kind's icon (which the title draws first, as its ::before). */}
                <ChevronDown className={`-order-1 w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">{title}</span>
            </button>
            {open && <div className="k-callout-fold-body">{parts.slice(titleAt + 1)}</div>}
        </blockquote>
    );
}

/** A blockquote: a citation's card (its words, then where they're from, opening the video at that moment), a callout
    *  that folds, or an ordinary quote. */
function Quote({ node, className, children, 'data-fold': fold }: { node?: unknown; className?: string; children?: ReactNode; 'data-fold'?: string }) {
    if (fold) return <FoldingCallout startOpen={fold !== 'closed'} className={className}>{children}</FoldingCallout>;
    const source = citationSource(node as HastNode | undefined);
    // Its classes kept: a callout is a quote drawn by them (lib/remark-callouts.ts).
    if (!source) return <blockquote className={className}>{children}</blockquote>;
    // The words: everything but the last paragraph (the source line).
    const parts = Children.toArray(children);
    let sourceAt = -1;
    for (let i = parts.length - 1; i >= 0; i--) if (isValidElement(parts[i])) { sourceAt = i; break; }
    const words = parts.filter((_, i) => i !== sourceAt);
    const tone = source.own ? '#6b7280' : 'var(--k-blockquote-accent, var(--k-accent))';
    // A quote attributed to someone by name (no video to open): the attribution is plain text, not a button.
    if (!source.videoId) {
        return (
            <div
                className="not-prose my-4 flex items-start gap-3 border-l-4 rounded-r-lg px-4 py-[0.6rem]"
                style={{ borderLeftColor: tone, backgroundColor: `color-mix(in srgb, ${tone} 8%, transparent)` }}
            >
                <QuoteIcon aria-label="Quoted" className="w-6 h-6 mt-0.5 shrink-0 text-[var(--k-blockquote-accent,var(--k-accent))] fill-current" />
                <div className="min-w-0 flex-1">
                    <div className={`prose dark:prose-invert prose-sm max-w-none text-gray-100 [&_p]:my-1 italic`}>{words}</div>
                    <span className="mt-2 block text-[12px] text-gray-400">— {source.attribution}</span>
                </div>
            </div>
        );
    }
    const videoId = source.videoId;
    return (
        // The shape of a quote and of a callout (index.css's .prose blockquote): a straight bar of color down the left, that
        // color's tint behind, and round corners on the right alone. The reader's own thought about a moment is told
        // from the video's words: gray where a quote has the accent, upright text, and a quill where a quote has its
        // large quote mark.
        <div
            className="not-prose my-4 flex items-start gap-3 border-l-4 rounded-r-lg px-4 py-[0.6rem]"
            style={{ borderLeftColor: tone, backgroundColor: `color-mix(in srgb, ${tone} ${source.own ? 10 : 8}%, transparent)` }}
        >
            {source.own
                ? <Feather aria-label="Your thought" className="w-6 h-6 mt-0.5 shrink-0 text-gray-500" />
                : <QuoteIcon aria-label="Quoted" className="w-6 h-6 mt-0.5 shrink-0 text-[var(--k-blockquote-accent,var(--k-accent))] fill-current" />}
            <div className="min-w-0 flex-1">
                <div className={`prose dark:prose-invert prose-sm max-w-none text-gray-100 [&_p]:my-1 ${source.own ? '' : 'italic'}`}>{words}</div>
                <button
                    type="button"
                    onClick={() => openInternalLink('video', videoId, source.at)}
                    className="mt-2 flex items-center gap-2 min-w-0 max-w-full text-[12px] text-gray-400 hover:text-white transition-colors cursor-pointer"
                    title={`${source.own ? 'Your thought on this video. ' : ''}${source.at !== undefined ? `Open the video at ${formatClock(Math.floor(source.at))}` : 'Open the video'}`}
                >
                    <span className="truncate">{source.title}</span>
                    {source.at !== undefined ? <TimeTag at={source.at} /> : <VideoTag />}
                </button>
            </div>
        </div>
    );
}

/** A video linked on a line of its own, as a note shows it: one line naming the source (its title, who made it, and the
 *  moment when the link has one), not the thumbnail card other texts unfold it into (LinkEmbed.tsx). A note is writing,
 *  and a row of big pictures would bury it. Opens the video like the link would; a video that's gone shows as the link. */
function VideoReference({ videoId, at, fallback }: { videoId: string; at?: number; fallback: ReactNode }) {
    const [video, setVideo] = useState<{ title: string; author: string } | null | undefined>(undefined);
    useEffect(() => {
        let live = true;
        setVideo(undefined);
        getVideoCard(videoId)
            .then(v => { if (live) setVideo(v ? { title: v.title, author: v.author ?? '' } : null); })
            .catch(() => { if (live) setVideo(null); });
        return () => { live = false; };
    }, [videoId]);
    if (video === null) return <>{fallback}</>;
    return (
        <button
            type="button"
            onClick={() => openInternalLink('video', videoId, at)}
            title={at !== undefined ? `Open this video at ${formatClock(Math.floor(at))}` : 'Open this video'}
            className="not-prose my-2 flex items-center gap-2.5 max-w-full w-fit rounded-lg border border-[#2a2a2a] bg-[#151515] hover:border-[#444] px-3 py-1.5 text-left transition-colors cursor-pointer"
        >
            <VideoIcon className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />
            <span className="min-w-0 truncate text-[13px] font-semibold text-gray-100">{video?.title ?? '…'}</span>
            {video?.author && <span className="shrink-0 max-w-[35%] truncate text-[12px] text-gray-500">{video.author}</span>}
            {at !== undefined ? <TimeTag at={at} /> : <VideoTag />}
        </button>
    );
}

/** A flashcards link, as a note shows it: a small box with the stack-of-cards mark, the link's words, and the Drive
 *  whose terms it opens, so it reads as something to go and do, not as a word that happens to be a link. Sits in the
 *  line of text it was written in. */
function FlashcardsLink({ drive, href, children }: { drive: string; href?: string; children?: ReactNode }) {
    const deck = drive === ALL_TERMS ? 'All Terms' : driveLabel(drive);
    return (
        <button
            type="button"
            onClick={() => openInternalLink('flashcards', drive)}
            title={`Open Flashcards: ${deck}`}
            // For "Copy as Markdown" on a selection (lib/selection-markdown.ts), the link's real address.
            data-md-href={href}
            className="not-prose inline-flex items-center gap-2 max-w-full align-middle rounded-lg border border-[#2a2a2a] bg-[#151515] hover:border-[#444] px-2.5 py-1 text-left transition-colors cursor-pointer"
        >
            <GalleryVerticalEnd className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />
            <span className="min-w-0 truncate text-[13px] font-semibold text-gray-100">{children}</span>
            <span className="shrink-0 text-[11px] font-mono text-gray-500">{deck}</span>
        </button>
    );
}

/** A note's links: as everywhere (MarkdownLink), except a video on a line of its own, which is a VideoReference, and a
 *  flashcards link, which is a FlashcardsLink. */
function NoteLink(props: Parameters<typeof MarkdownLink>[0]) {
    const internal = parseInternalHref(props.href);
    if (internal?.kind === 'flashcards') return <FlashcardsLink drive={internal.key} href={props.href}>{props.children}</FlashcardsLink>;
    if (props['data-embed'] && internal?.kind === 'video') {
        return <VideoReference videoId={internal.key} at={internal.at} fallback={<MarkdownLink {...props} data-embed={undefined} />} />;
    }
    return <MarkdownLink {...props} />;
}

/** A question's answer (lib/remark-qa.ts), covered until it's asked for, so a note's questions can be tried before the
 *  answer is seen: blurred under a Show Answer button, and Hide Answer covers it again. Each one on its own. */
function QaAnswer({ children }: { children?: ReactNode }) {
    const [shown, setShown] = useState(false);
    return (
        <div className="relative rounded-md border border-[#262626] bg-[#101010] px-3 py-2">
            {/* Covered, it can't be read, selected or clicked through (a link in it would otherwise still open). */}
            <div aria-hidden={!shown} className={`text-gray-300 transition-[filter] duration-200 ${shown ? '' : 'blur-[6px] opacity-50 select-none pointer-events-none'}`}>{children}</div>
            {shown ? (
                <button type="button" onClick={() => setShown(false)} className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-white transition-colors cursor-pointer">
                    <EyeOff className="w-3 h-3" /> Hide Answer
                </button>
            ) : (
                <button type="button" onClick={() => setShown(true)} className="group absolute inset-0 flex items-center justify-center rounded-md cursor-pointer" title="Show the answer">
                    {/* Words on the covered answer, not a button drawn inside a button: the whole cover is what's clicked.
                        The shadow keeps them readable where they sit over the blurred lines. */}
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 group-hover:text-white transition-colors drop-shadow-[0_0_5px_#101010]">
                        <Eye className="w-3 h-3" /> Show Answer
                    </span>
                </button>
            )}
        </div>
    );
}

/** A note's blocks: the two parts of a question-and-answer block are drawn here (the question behind a mark of its own,
 *  as a video's line and a citation's source have theirs; the answer covered), and any other div is left as it is. */
function NoteBlock({ node: _node, className, children, ...props }: ComponentProps<'div'> & { node?: unknown }) {
    const classes = className?.split(' ') ?? [];
    if (classes.includes(QA_QUESTION_CLASS)) {
        return (
            <div className="flex items-start gap-2.5">
                <MessageCircleQuestionMark className="w-4 h-4 mt-[3px] shrink-0 text-[var(--k-accent)]" />
                <div className="min-w-0 flex-1 font-semibold text-gray-100">{children}</div>
            </div>
        );
    }
    if (classes.includes(QA_ANSWER_CLASS)) return <QaAnswer>{children}</QaAnswer>;
    return <div className={className} {...props}>{children}</div>;
}

/** What ticking a task's box while reading does, given the line of the note the task is written on (1-based). Null
 *  where the note can't be changed: the boxes then only show. */
const TaskToggle = createContext<((line: number) => void) | null>(null);

/** A list item: a task's box (`- [ ]`) can be ticked here, while reading, and the note's text is changed to match. */
function NoteItem({ node, className, children, ...props }: ComponentProps<'li'> & { node?: { position?: { start?: { line?: number } } } }) {
    const toggle = useContext(TaskToggle);
    const line = node?.position?.start?.line;
    if (!toggle || !line || !className?.includes('task-list-item')) return <li className={className} {...props}>{children}</li>;
    // The box markdown drew is a disabled one: put a live one in its place (it's the item's first thing, or the first
    // thing in the item's first paragraph when the list is spaced out).
    const live = (kids: ReactNode): ReactNode => Children.map(kids, kid => {
        if (!isValidElement<{ type?: string; checked?: boolean; children?: ReactNode }>(kid)) return kid;
        if (kid.props.type === 'checkbox') {
            return <input type="checkbox" checked={Boolean(kid.props.checked)} onChange={() => toggle(line)} className="cursor-pointer" />;
        }
        return kid.type === 'p' ? cloneElement(kid, undefined, live(kid.props.children)) : kid;
    });
    return <li className={className} {...props}>{live(children)}</li>;
}

/** A note as it reads: Markdown, with citations as cards and its "Q:" / "A:" lines as question-and-answer blocks. */
function NoteReading({ body }: { body: string }) {
    if (!body.trim()) return <p className="text-sm text-gray-600 italic">Nothing written yet.</p>;
    return (
        <div className="leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-pre:bg-black/50 prose-code:text-red-400">
            <ReactMarkdown
                // Callouts can fold here, and have a title of their own, written as Obsidian writes them.
                // And maths: `$...$` in a line, `$$...$$` on lines of its own (lib/note-math.ts).
                remarkPlugins={[...NOTE_MATH_REMARK, remarkGfm, remarkQa, [remarkCallouts, { foldable: true }], remarkHighlight, [remarkTimestamps, { chips: false }], remarkEmbeds]}
                rehypePlugins={[...NOTE_MATH_REHYPE, ...CODE_HIGHLIGHT]}
                urlTransform={markdownUrlTransform}
                components={{
                    a: NoteLink,
                    blockquote: Quote,
                    div: NoteBlock,
                    li: NoteItem,
                    img: ({ node: _node, ...props }) => <img {...props} className="rounded-xl border border-white/10" />,
                }}
            >
                {body}
            </ReactMarkdown>
        </div>
    );
}

// ── Small dropdowns ──────────────────────────────────────────────────────────

/** A button that opens a panel under it, closed by a click outside or Esc. */
function Dropdown({ button, children, align = 'left', width = 'w-64' }: {
    button: (open: boolean, toggle: () => void) => ReactNode;
    children: (close: () => void) => ReactNode;
    align?: 'left' | 'right';
    width?: string;
}) {
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss(open, close, boxRef);
    return (
        <div ref={boxRef} className="relative">
            {button(open, () => setOpen(o => !o))}
            {open && (
                <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-30 ${width} max-h-80 overflow-y-auto custom-scrollbar bg-[#141414] border border-[#333] rounded-xl py-1 shadow-xl text-sm`}>
                    {children(close)}
                </div>
            )}
        </div>
    );
}

/** Adds the open note to a Calendar track (one that keeps its own list, not one following a Drive's sequence). */
function AddToCalendar({ noteId, compact = false, onDone }: { noteId: string; /** Its icon alone (the name is its tooltip). */ compact?: boolean; onDone: (message: string, ok: boolean) => void }) {
    const { labels } = useWorkspace();
    const [tracks, setTracks] = useState<CalendarTrackSummary[] | null>(null);
    return (
        <Dropdown
            align="right"
            width="w-60"
            button={(open, toggle) => (
                <button
                    type="button"
                    onClick={() => {
                        if (!open) listCalendarTracks(false).then(setTracks).catch(() => setTracks([]));
                        toggle();
                    }}
                    title={`Add this note to a ${labels.aliasCalendar} track, as a step of its own`}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer"
                >
                    <CalendarPlus className="w-3.5 h-3.5" /> {!compact && `Add to ${labels.aliasCalendar}`}
                </button>
            )}
        >
            {close => {
                const usable = (tracks ?? []).filter(t => !t.track.sourceDriveSequence && !t.track.archived);
                if (!tracks) return <p className="px-4 py-2 text-xs text-gray-500">Loading tracks…</p>;
                if (usable.length === 0) return <p className="px-4 py-2 text-xs text-gray-500">No tracks to add it to. Make one in the {labels.aliasCalendar} first.</p>;
                return usable.map(t => (
                    <button
                        key={t.track.id}
                        type="button"
                        onClick={() => {
                            close();
                            addCalendarNoteEntry(t.track.id, noteId)
                                .then(() => onDone(`Added to "${t.track.name}"`, true))
                                .catch(e => onDone(typeof e === 'string' ? e : e?.message ?? "Couldn't add it.", false));
                        }}
                        className="w-full px-4 py-2 text-left text-gray-200 hover:bg-[#222222] transition-colors cursor-pointer truncate"
                    >
                        {t.track.name}
                    </button>
                ));
            }}
        </Dropdown>
    );
}

/** Puts the open note into workbooks, or takes it out: each workbook listed with a tick when the note is in it. A
 *  personal note isn't taken into a shared workbook (the message says to share the note first). */
function AddToWorkbook({ noteId, books, compact = false, onNotify }: { noteId: string; books: Workbook[]; compact?: boolean; onNotify: (n: NotificationContent) => void }) {
    const inAny = books.some(b => b.noteIds.includes(noteId));
    return (
        <Dropdown
            align="right"
            width="w-60"
            button={(_open, toggle) => (
                <button
                    type="button"
                    onClick={toggle}
                    title="Put this note in a workbook (notes in an order, read a page at a time), or take it out"
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold hover:text-white hover:bg-[#272727] transition-colors cursor-pointer ${inAny ? 'text-gray-200' : 'text-gray-400'}`}
                >
                    <BookOpenText className="w-3.5 h-3.5" /> {!compact && 'Add to Workbook'}
                </button>
            )}
        >
            {() => books.length === 0
                ? <p className="px-4 py-2 text-xs text-gray-500 leading-relaxed">No workbooks yet. Make one under Workbooks, in the list on the left.</p>
                : books.map(b => {
                    const has = b.noteIds.includes(noteId);
                    return (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                                (has ? removeNoteFromWorkbook(b.id, noteId) : addNoteToWorkbook(b.id, noteId))
                                    .then(() => onNotify({ message: has ? `Taken out of "${b.title}"` : `Added to "${b.title}"`, type: 'success' }))
                                    .catch(e => onNotify({ message: errorText(e), type: 'error' }));
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left text-gray-200 hover:bg-[#222222] transition-colors cursor-pointer"
                        >
                            <span className="min-w-0 flex-1 truncate">{b.title}</span>
                            {b.shared ? <Users className="w-3 h-3 shrink-0 text-gray-500" /> : <User className="w-3 h-3 shrink-0 text-gray-500" />}
                            <Check className={`w-3.5 h-3.5 shrink-0 text-[var(--k-accent)] ${has ? '' : 'invisible'}`} />
                        </button>
                    );
                })}
        </Dropdown>
    );
}

/** Where the Notes panel's side (notes or workbooks) and the open workbook are remembered. */
/** How the notes and the workbooks are listed: by when they were last edited (the usual), when they were made, or by
 *  name. A date starts newest first and a name A to Z; the arrow turns either round. */
interface ListSort { field: 'updated' | 'created' | 'title'; order: 'asc' | 'desc' }
const SORT_KEY = 'kinesis.notes.sort';
const SORT_FIELDS: { field: ListSort['field']; label: string; title: string; icon: typeof Clock }[] = [
    { field: 'updated', label: 'Edited', title: 'Last Edited', icon: Clock },
    { field: 'created', label: 'Created', title: 'Date Created', icon: Calendar },
    { field: 'title', label: 'Title', title: 'Title', icon: Type },
];
function sorter<T extends { id: string; createdAt: string; updatedAt: string }>(sort: ListSort, nameOf: (item: T) => string) {
    return (a: T, b: T) => {
        const cmp = sort.field === 'title' ? nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base', numeric: true })
            : sort.field === 'created' ? a.createdAt.localeCompare(b.createdAt)
            : a.updatedAt.localeCompare(b.updatedAt);
        return (sort.order === 'asc' ? cmp : -cmp) || a.id.localeCompare(b.id);
    };
}

const PANEL_TAB_KEY = 'kinesis.notes.panelTab';
const BOOK_KEY = 'kinesis.notes.workbook';

// ── The section ──────────────────────────────────────────────────────────────

/**
 * The Notes section (docs/kinesis-design.tex, "Notes"): pages of the reader's own writing that cite videos, moments and
 * passages. The list of notes on the left (the most recently changed first; App's button beside the search bar shows
 * and hides it, and the search bar filters it), the open note in the middle, and what it cites on the right. A note saves itself shortly after typing stops: there's no Save button and no edit mode to enter.
 * Write shows the Markdown being written; Read shows it as it reads, citations as cards.
 *
 * A note is personal (the reader's own: allowed in a read-only workspace, never exported) or shared (travels with the
 * workspace; editing it needs allowEditSharedNotes). The note open here is the active one, which the sidebar's cite
 * commands write into (lib/notes.ts).
 */
export function NotesView({ searchQuery, panelOpen, openNoteId, onOpenNote, onNotify, onOpenTrash, reloadSignal, displaySettings, customThemes }: {
    /** The header search bar's text: plain words (looked for in titles and text), or `title_search:` and words (titles only). */
    searchQuery: string;
    /** Whether the list of notes is showing (App's toggle, beside the search bar). */
    panelOpen: boolean;
    /** The note open in the page (App keeps it, so Back/Forward can return to it). */
    openNoteId: string | null;
    onOpenNote: (id: string | null) => void;
    onNotify: (n: NotificationContent) => void;
    onOpenTrash: () => void;
    /** Bumped when a note comes back from the Trash. */
    reloadSignal?: number;
    displaySettings?: DisplaySettings | null;
    customThemes?: Theme[];
}) {
    const contentTheme = useMemo(
        () => resolveContentTheme(displaySettings, customThemes ?? []),
        [displaySettings, customThemes],
    );
    const contentThemeStyle = useMemo(
        () => displaySettings?.contentThemeNotesEnabled
            ? ({
                ...getThemeCssVariables(contentTheme, displaySettings.blockquoteAccentEnabled ? displaySettings.blockquoteAccentColor : null),
                colorScheme: contentTheme.scheme,
                backgroundColor: 'var(--k-bg)',
                color: 'var(--k-text-white)',
            } as React.CSSProperties)
            : undefined,
        [displaySettings, contentTheme],
    );
    const { flags } = useFlags();
    const { labels } = useWorkspace();
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [roots, setRoots] = useState<WdbsRoot[]>([]);
    const [driveFilter, setDriveFilter] = useState('');
    // Workbooks: all of them, which side of the panel is showing, and the one open (its notes are then paged through
    // at the foot of the page). Both remembered in this browser.
    const [books, setBooks] = useState<Workbook[]>([]);
    const [panelTab, setPanelTabState] = useState<'notes' | 'workbooks'>(() => {
        try { return localStorage.getItem(PANEL_TAB_KEY) === 'workbooks' ? 'workbooks' : 'notes'; } catch { return 'notes'; }
    });
    const setPanelTab = (t: 'notes' | 'workbooks') => {
        setPanelTabState(t);
        try { localStorage.setItem(PANEL_TAB_KEY, t); } catch { /* just not remembered */ }
    };
    const [bookId, setBookId] = useState<string | null>(() => { try { return localStorage.getItem(BOOK_KEY); } catch { return null; } });
    // The order the notes and the workbooks are listed in (the status bar's sort buttons), remembered in this browser.
    const [sort, setSortState] = useState<ListSort>(() => {
        try {
            const [field, order] = (localStorage.getItem(SORT_KEY) ?? '').split(' ');
            if ((field === 'updated' || field === 'created' || field === 'title') && (order === 'asc' || order === 'desc')) return { field, order };
        } catch { /* the usual order */ }
        return { field: 'updated', order: 'desc' };
    });
    const setSort = (s: ListSort) => {
        setSortState(s);
        try { localStorage.setItem(SORT_KEY, `${s.field} ${s.order}`); } catch { /* just not remembered */ }
    };
    useEffect(() => {
        const load = () => listWorkbooks().then(setBooks).catch(() => setBooks([]));
        void load();
        window.addEventListener(WORKBOOKS_CHANGED_EVENT, load);
        // A note shared, made personal, deleted or restored changes what a workbook lists.
        window.addEventListener(NOTES_CHANGED_EVENT, load);
        return () => {
            window.removeEventListener(WORKBOOKS_CHANGED_EVENT, load);
            window.removeEventListener(NOTES_CHANGED_EVENT, load);
        };
    }, []);
    const book = books.find(b => b.id === bookId) ?? null;
    // Opening a workbook shows its side of the panel and its first page, unless the note open is already one of its.
    const openBook = useCallback((id: string | null, page?: string) => {
        setBookId(id);
        try { if (id) localStorage.setItem(BOOK_KEY, id); else localStorage.removeItem(BOOK_KEY); } catch { /* just not remembered */ }
        if (!id) return;
        setPanelTabState('workbooks');
        listWorkbooks().then(all => {
            setBooks(all);
            const b = all.find(x => x.id === id);
            // Asked for with a page of it (a Calendar entry): that note is being opened already, so stay on it.
            if (page) return;
            if (b && b.noteIds.length > 0 && !(draftRef.current && b.noteIds.includes(draftRef.current.id))) onOpenNote(b.noteIds[0]);
        }).catch(() => {});
    }, [onOpenNote]);
    // A workbook asked for from elsewhere (a link to it): now, if one is waiting, and whenever one is asked for.
    useEffect(() => {
        const take = () => {
            const asked = takeRequestedWorkbook();
            if (!asked) return;
            // With a page: only when the workbook still holds that note (else the note just opens on its own).
            if (asked.noteId) listWorkbooks().then(all => { if (all.find(b => b.id === asked.id)?.noteIds.includes(asked.noteId!)) openBook(asked.id, asked.noteId); }).catch(() => {});
            else openBook(asked.id);
        };
        take();
        window.addEventListener(OPEN_WORKBOOK_EVENT, take);
        return () => window.removeEventListener(OPEN_WORKBOOK_EVENT, take);
    }, [openBook]);
    const [draft, setDraft] = useState<Draft | null>(null);
    // Write or Read is the reader's choice, not the note's: it stays as it is from one note to the next, and is
    // remembered in this browser, so whoever left the section reading comes back to it reading. A note that can't be
    // edited is shown read whatever the choice is (`mode` below), without changing it.
    const [chosenMode, setChosenMode] = useState<'write' | 'read'>(() => {
        try { return localStorage.getItem(MODE_KEY) === 'read' ? 'read' : 'write'; } catch { return 'write'; }
    });
    const setMode = useCallback((m: 'write' | 'read') => {
        // Save this mode's scroll position before switching: the content re-renders
        // (textarea <-> markdown) with different heights, so the browser will lose it.
        const c = notePageRef.current;
        if (c) {
            const key = chosenMode === 'write' ? 'write' : 'read';
            scrollPositionsRef.current[key] = c.scrollTop;
        }
        setChosenMode(m);
        try { localStorage.setItem(MODE_KEY, m); } catch { /* just not remembered */ }
    }, [chosenMode]);
    const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
    const [saveError, setSaveError] = useState<string | null>(null);
    // A task's box ticked while reading: its line of the note is rewritten, `[ ]` to `[x]` or back (and the note saves
    // itself as after any edit). A line that isn't a task any more is left alone.
    const toggleTask = useCallback((line: number) => {
        setDraft(d => {
            if (!d) return d;
            const lines = d.body.split('\n');
            const at = lines[line - 1];
            const m = at === undefined ? null : /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(at);
            if (!m) return d;
            lines[line - 1] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + at.slice(m[0].length);
            return { ...d, body: lines.join('\n') };
        });
    }, []);
    const [toDelete, setToDelete] = useState<Note | null>(null);
    // "Make Glossary Term" from the editor's right-click: the selection it was asked over, while its window is open.
    const [makingTerm, setMakingTerm] = useState<MakeTermRequest | null>(null);
    const canMakeTerms = flags.showGlossary && flags.allowModificationGlossary;
    useEffect(() => {
        const onAsk = (e: Event) => setMakingTerm((e as CustomEvent<MakeTermRequest>).detail);
        window.addEventListener(MAKE_TERM_EVENT, onAsk);
        return () => window.removeEventListener(MAKE_TERM_EVENT, onAsk);
    }, []);
    // The page's tools (Add to Calendar, Personal, Write / Read) sit on one line at the right of the note's Drives, and
    // never drop to a line of their own: where the page is too narrow for their names, they're their icons alone (each
    // says what it is when pointed at) and the Drives wrap in the room that's left.
    const headRef = useRef<HTMLDivElement>(null);
    const [compactTools, setCompactTools] = useState(false);
    const noteOpen = draft !== null;
    useLayoutEffect(() => {
        const head = headRef.current;
        if (!head) return;
        const fit = () => setCompactTools(head.clientWidth < COMPACT_TOOLS_BELOW);
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(head);
        return () => observer.disconnect();
    }, [noteOpen]);
    // The Sources panel, for a window too narrow for the Sources column: opened from the status bar, closed by a click
    // outside it, Esc, or its X.
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const sourcesPanelRef = useRef<HTMLDivElement>(null);
    const sourcesButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!sourcesOpen) return;
        const onDown = (e: MouseEvent) => {
            const at = e.target as Node;
            // Not its own button: that one's click closes it.
            if (!sourcesPanelRef.current?.contains(at) && !sourcesButtonRef.current?.contains(at)) setSourcesOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSourcesOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [sourcesOpen]);
    const [confirmShare, setConfirmShare] = useState(false);
    const savedRef = useRef<Draft | null>(null);
    const draftRef = useRef<Draft | null>(null);
    draftRef.current = draft;
    const titleRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const typingRef = useRef(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Save and restore scroll position when switching between Read and Write: the
    // textarea is auto-sized on entering Write, so its height changes, which
    // otherwise sends the page back to the top. Each mode keeps its own position,
    // so scrolling in one and switching over keeps you where you were, and vice-versa.
    const notePageRef = useRef<HTMLDivElement>(null);
    const scrollPositionsRef = useRef<{ write: number; read: number }>({ write: 0, read: 0 });

    const canEditNote = useCallback((shared: boolean) => !shared || flags.allowEditSharedNotes, [flags.allowEditSharedNotes]);
    const canEdit = draft !== null && canEditNote(draft.shared);
    const canEditRef = useRef(canEdit);
    canEditRef.current = canEdit;
    const mode = canEdit ? chosenMode : 'read';
    // Ctrl+F: finds in the open note, and replaces while it's being written (NoteFind.tsx).
    const find = useNoteFind({
        enabled: draft !== null,
        noteId: draft?.id ?? null,
        mode,
        body: draft?.body ?? '',
        setBody: body => setDraft(d => d && { ...d, body }),
        bodyRef,
    });

    const loadList = useCallback(() => {
        listNotes().then(setNotes).catch(e => { setNotes([]); onNotify({ message: `Couldn't load notes: ${String(e)}`, type: 'error' }); });
    }, [onNotify]);
    useEffect(() => { loadList(); }, [loadList, reloadSignal]);
    useEffect(() => { getWdbsRoots().then(setRoots).catch(() => setRoots([])); }, []);

    // ── Saving ──
    const save = useCallback(async (d: Draft) => {
        setStatus('saving');
        try {
            const saved = await updateNote(d.id, d.title, d.body, d.drives);
            savedRef.current = { ...d };
            setNotes(list => list && [saved, ...list.filter(n => n.id !== saved.id)]);
            setSaveError(null);
            // Still what's on screen: saved. (Typed on since: the next save is on its way.)
            setStatus(draftRef.current && draftRef.current.id === d.id && !sameContent(draftRef.current, d) ? 'unsaved' : 'saved');
        } catch (e) {
            setStatus('error');
            setSaveError(typeof e === 'string' ? e : (e as Error)?.message ?? "Couldn't save.");
        }
    }, []);
    const flush = useCallback(() => {
        const d = draftRef.current;
        if (d && savedRef.current && savedRef.current.id === d.id && !sameContent(d, savedRef.current) && canEditNote(d.shared)) void save(d);
    }, [save, canEditNote]);
    useEffect(() => {
        if (!draft || !savedRef.current || savedRef.current.id !== draft.id || sameContent(draft, savedRef.current)) return;
        setStatus('unsaved');
        const timer = window.setTimeout(() => void save(draft), SAVE_AFTER_MS);
        return () => window.clearTimeout(timer);
    }, [draft, save]);
    // Leaving the section (or the app) saves what's waiting.
    useEffect(() => () => flush(), [flush]);
    useEffect(() => {
        window.addEventListener('beforeunload', flush);
        return () => window.removeEventListener('beforeunload', flush);
    }, [flush]);

    // ── Opening a note ──
    useEffect(() => {
        flush();
        if (!openNoteId) { setDraft(null); savedRef.current = null; return; }
        let live = true;
        getNote(openNoteId).then(n => {
            if (!live) return;
            if (!n) { onOpenNote(null); return; }
            const d = draftOf(n);
            savedRef.current = d;
            setDraft(d);
            setStatus('saved');
            setSaveError(null);
            setActiveNoteId(n.id);
        }).catch(() => { if (live) onOpenNote(null); });
        return () => { live = false; };
    }, [openNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Notes changed elsewhere (a citation added from the sidebar while this note wasn't open, a move, a delete).
    useEffect(() => {
        const onChanged = (e: Event) => {
            loadList();
            const id = (e as CustomEvent<string | null>).detail;
            const d = draftRef.current;
            if (!d || (id !== null && id !== d.id)) return;
            getNote(d.id).then(n => {
                if (!n) { onOpenNote(null); return; }
                const current = draftRef.current;
                // Whatever is being typed wins; otherwise take the stored note.
                if (current && savedRef.current && sameContent(current, savedRef.current)) {
                    savedRef.current = draftOf(n);
                    setDraft(draftOf(n));
                } else if (current) {
                    setDraft({ ...current, shared: n.shared });
                }
            }).catch(() => {});
        };
        window.addEventListener(NOTES_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(NOTES_CHANGED_EVENT, onChanged);
    }, [loadList, onOpenNote]);

    // A citation for the note open here goes into what's being written (lib/notes.ts's citeIntoNote).
    useEffect(() => {
        const onAppend = (e: Event) => {
            const request = (e as CustomEvent<NoteAppendRequest>).detail;
            if (draftRef.current?.id !== request.id || !canEditRef.current) return;
            request.handled = true;
            setDraft(d => d && { ...d, body: joinParagraphs(d.body, request.text) });
        };
        window.addEventListener(NOTE_APPEND_EVENT, onAppend);
        return () => window.removeEventListener(NOTE_APPEND_EVENT, onAppend);
    }, []);

    // The body grows with what's written; the page scrolls, not the box.
    useLayoutEffect(() => {
        if (typingRef.current) return;
        const el = bodyRef.current;
        if (!el) return;
        // Force reflow to get accurate scrollHeight
        el.style.height = 'auto';
        // Use requestAnimationFrame to ensure layout is settled
        requestAnimationFrame(() => {
            if (!el) return;
            el.style.height = `${Math.max(el.scrollHeight, 320)}px`;
        });
    }, [draft?.body, mode, draft?.id]);
    // Restore the saved scroll position when switching modes. Use a frame to let the
    // textarea height settle (its resize effect runs before this one).
    useLayoutEffect(() => {
        const container = notePageRef.current;
        if (!container) return;
        const key = mode === 'write' ? 'write' : 'read';
        requestAnimationFrame(() => {
            if (notePageRef.current) notePageRef.current.scrollTop = scrollPositionsRef.current[key];
        });
    }, [mode]);

    // ── Actions ──
     // A new note: blank, or started from a template (its title and text use {{monthName}}, {{year}}, {{season}} which are supported).
     const newNote = async (template?: NoteTemplate) => {
         flush();
         try {
             // If a template is provided, check if there's already an untouched note for this template
             if (template) {
                 // Get the current notes list, or load it if necessary
                 let notesList: Note[] | null = notes;
                 if (notesList === null) {
                     notesList = await listNotes().catch(() => null);
                 }
                 if (notesList) {
                     // Look for a note that is an untouched instance of this template
                     const matchingNote = notesList.find(note => {
                         return isUntouchedTemplate(note.title, note.body, [template]);
                     });
                     if (matchingNote) {
                         // Jump to the existing note
                         onOpenNote(matchingNote.id);
                         setMode('write'); // or 'read'? We'll set to write so the user can edit it.
                         // Note: the note opening will set the draft and mode accordingly.
                         return;
                     }
                 }
             }
             // Otherwise, create a new note as before
             const today = calendarToday();
             const n = await createNote({
                 shared: false,
                 title: template ? fillTemplate(template.title, today) : '',
                 body: template ? fillTemplate(template.body, today) : '',
                 drives: driveFilter && driveFilter !== UNASSIGNED ? [driveFilter] : [],
             });
             setNotes(list => [n, ...(list ?? [])]);
             onOpenNote(n.id);
             setMode('write');
             window.setTimeout(() => titleRef.current?.focus(), 50);
         } catch (e) {
             onNotify({ message: `Couldn't make a note: ${String(e)}`, type: 'error' });
         }
     };

    // Templates: the workspace's own (the app's come with it), the menu beside New Note, and the name being typed
    // for one made from the open note.
    const [templates, setTemplates] = useState<NoteTemplate[]>([]);
    const [templateMenu, setTemplateMenu] = useState(false);
    const [templateName, setTemplateName] = useState<string | null>(null);
    const templateMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => { loadNoteTemplates().then(setTemplates).catch(() => {}); }, []);
    useDismiss(templateMenu, () => { setTemplateMenu(false); setTemplateName(null); }, templateMenuRef);
    const saveAsTemplate = async () => {
        const d = draftRef.current;
        const name = (templateName ?? '').trim();
        if (!d || !name) return;
        try {
            setTemplates(await saveNoteTemplate({ name, title: '', body: d.body }));
            setTemplateName(null);
            setTemplateMenu(false);
            onNotify({ message: `Saved as the template "${name}"`, type: 'success' });
        } catch (e) {
            onNotify({ message: `Couldn't save the template: ${String(e)}`, type: 'error' });
        }
    };

    // `forever`: nothing of the reader's is in it (askDelete), so it isn't kept in the Trash and there's no Undo.
    const remove = async (note: Note, forever = false) => {
        setToDelete(null);
        try {
            const kept = await deleteNote(note.id);
            if (forever && kept !== null) await trashDiscard(kept).catch(() => {});
            const trashId = forever ? null : kept;
            if (getActiveNoteId() === note.id) setActiveNoteId(null);
            if (openNoteId === note.id) { savedRef.current = null; onOpenNote(null); }
            setNotes(list => list && list.filter(n => n.id !== note.id));
            const name = noteDisplayTitle(note);
            onNotify({
                message: `Deleted "${name}"`,
                type: 'success',
                action: trashId === null ? undefined : {
                    label: 'Undo',
                    onClick: () => {
                        trashRestore(trashId)
                            .then(() => { loadList(); onNotify({ message: `Restored "${name}"`, type: 'success' }); })
                            .catch(e => onNotify({ message: `Couldn't restore: ${typeof e === 'string' ? e : e?.message ?? e}`, type: 'error' }));
                    },
                },
            });
        } catch (e) {
            onNotify({ message: `Couldn't delete: ${String(e)}`, type: 'error' });
        }
    };
    // Asked whatever Confirm Before Deleting is set to: a note is someone's own writing, and the Trash it goes to only
    // lasts until the app is closed. Not asked when there's nothing of theirs in it: a note that's empty, or still
    // exactly what its template gave it (the open note is judged by what's on screen, saved yet or not). That one is
    // gone for good: not in the Trash, no Undo.
    const askDelete = (note: Note) => {
        const now = draftRef.current?.id === note.id ? draftRef.current : note;
        const nothingWritten = (!now.title.trim() && !now.body.trim()) || isUntouchedTemplate(now.title, now.body, [...BUILT_IN_TEMPLATES, ...templates]);
        if (nothingWritten) void remove(note, true); else setToDelete(note);
    };

    const canCalendar = flags.viewVisible.calendar && !flags.workspaceReadOnly;
    // The Calendar's tracks, for the right-click menus here and in the workbooks panel: asked for as a menu opens, so
    // a track made a moment ago is in it.
    const [menuTracks, setMenuTracks] = useState<CalendarTrackSummary[]>([]);
    const wantTracks = useCallback(() => {
        if (canCalendar) listCalendarTracks(false).then(setMenuTracks).catch(() => setMenuTracks([]));
    }, [canCalendar]);

    // A note as it is now: the open one by what's on screen (saved yet or not), another by what's stored.
    const current = (note: Note) => (draftRef.current?.id === note.id ? { ...note, ...draftRef.current } : note);
    // A copy's title: the original's with " (copy)" after it. A title is at most 200 characters, so a long one is
    // cut to leave room: it's the mark that's kept whole, not the end of the title. An untitled note's copy is untitled.
    const copyTitle = (title: string) => {
        const mark = ' (copy)';
        const base = title.trim();
        return base ? `${base.slice(0, 200 - mark.length).trimEnd()}${mark}` : '';
    };
    // A copy of a note, beside it: personal whatever the original is (sharing is a choice made for each note), under
    // the same Drives, and opened to be written in.
    const duplicate = async (note: Note) => {
        const from = current(note);
        flush();
        try {
            const n = await createNote({ shared: false, title: copyTitle(from.title), body: from.body, drives: from.drives });
            setNotes(list => [n, ...(list ?? [])]);
            onOpenNote(n.id);
            onNotify({ message: `Copied "${noteDisplayTitle(note)}"${note.shared ? ' (the copy is personal)' : ''}`, type: 'success' });
        } catch (e) {
            onNotify({ message: `Couldn't copy the note: ${String(e)}`, type: 'error' });
        }
    };
    // A note's text as a template, named after the note (with a number after it when that name is taken: a template
    // of the same name is never written over from here).
    const templateFrom = async (note: Note) => {
        const from = current(note);
        const taken = new Set([...BUILT_IN_TEMPLATES, ...templates].map(t => t.name.toLowerCase()));
        const base = noteDisplayTitle(note).slice(0, MAX_TEMPLATE_NAME - 4).trim();
        let name = base;
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
        try {
            setTemplates(await saveNoteTemplate({ name, title: '', body: from.body }));
            onNotify({ message: `Saved as the template "${name}" (under the arrow beside New Note)`, type: 'success' });
        } catch (e) {
            onNotify({ message: `Couldn't save the template: ${String(e)}`, type: 'error' });
        }
    };
    // Shared or personal, from the menu. The open note goes the way its own button does (saved first). Sharing is
    // asked about either way.
    const [toShare, setToShare] = useState<Note | null>(null);
    const shareOther = async (note: Note, shared: boolean) => {
        setToShare(null);
        try {
            const n = await setNoteShared(note.id, shared);
            setNotes(list => list && list.map(x => x.id === n.id ? n : x));
        } catch (e) {
            onNotify({ message: `Couldn't change that: ${String(e)}`, type: 'error' });
        }
    };
    const askShare = (note: Note) => {
        if (draftRef.current?.id === note.id) { if (note.shared) void setShared(false); else setConfirmShare(true); }
        else if (note.shared) void shareOther(note, false);
        else setToShare(note);
    };

    // The list's right-click menu, for the note it was opened on: into a workbook or out of one (each workbook ticked
    // when the note is in it, as under Add to Workbook on the page), onto a Calendar track, shared or personal, copied,
    // kept as a template, and Delete.
    const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
    const closeNoteMenu = useCallback(() => setNoteMenu(null), []);
    const noteMenuItems = (note: Note): ContextMenuItem[] => {
        const usable = menuTracks.filter(t => !t.track.sourceDriveSequence && !t.track.archived);
        return [
        { label: 'Open', icon: NotebookPen, onClick: () => onOpenNote(note.id) },
        {
            label: 'Add to Workbook',
            icon: BookOpenText,
            onClick: () => {},
            submenu: books.length === 0
                ? [{ label: 'No workbooks yet', disabled: true, onClick: () => {} }]
                : books.map(b => {
                    const has = b.noteIds.includes(note.id);
                    return {
                        label: b.title,
                        icon: b.shared ? Users : User,
                        checked: has,
                        onClick: () => {
                            (has ? removeNoteFromWorkbook(b.id, note.id) : addNoteToWorkbook(b.id, note.id))
                                .then(() => onNotify({ message: has ? `Taken out of "${b.title}"` : `Added to "${b.title}"`, type: 'success' }))
                                .catch(e => onNotify({ message: errorText(e), type: 'error' }));
                        },
                    };
                }),
        },
        // A track that follows a Drive's sequence holds only that sequence's videos, so it isn't offered. A track
        // holds a note once: asked to again, it says so and nothing changes.
        ...(canCalendar ? [{
            label: `Add to ${labels.aliasCalendar}`,
            icon: CalendarPlus,
            onClick: () => {},
            submenu: usable.length === 0
                ? [{ label: 'No tracks to add it to', disabled: true, onClick: () => {} }]
                : usable.map(t => ({
                    label: t.track.name,
                    onClick: () => {
                        addCalendarNoteEntry(t.track.id, note.id)
                            .then(() => onNotify({ message: `Added to "${t.track.name}"`, type: 'success' }))
                            .catch(e => onNotify({ message: errorText(e), type: 'error' }));
                    },
                })),
        }] : []),
        { label: note.shared ? 'Make Personal' : 'Share', icon: note.shared ? User : Users, divider: true, disabled: !flags.allowEditSharedNotes, onClick: () => askShare(note) },
        { label: 'Duplicate', icon: Copy, onClick: () => void duplicate(note) },
        { label: 'Save as a Template', icon: LayoutTemplate, disabled: !current(note).body.trim(), onClick: () => void templateFrom(note) },
        // A Markdown file of it, saved where the reader says (lib/note-export.ts): the note as it is now.
        {
            label: 'Export Note as Markdown', icon: FileDown,
            onClick: () => {
                exportNote(current(note))
                    .then(path => { if (path) onNotify({ message: `Saved "${noteDisplayTitle(current(note))}" to ${path}`, type: 'success' }); })
                    .catch(e => onNotify({ message: `Couldn't export the note: ${errorText(e)}`, type: 'error' }));
            },
        },
        { label: 'Delete Note', icon: Trash2, danger: true, divider: true, disabled: !canEditNote(note.shared), onClick: () => askDelete(note) },
        ];
    };

    const setShared = async (shared: boolean) => {
        const d = draftRef.current;
        if (!d) return;
        setConfirmShare(false);
        // Saved first, so what moves is what's on screen.
        if (savedRef.current && !sameContent(d, savedRef.current)) await save(d);
        try {
            const n = await setNoteShared(d.id, shared);
            savedRef.current = draftOf(n);
            setDraft(cur => cur && { ...cur, shared: n.shared });
            setNotes(list => list && list.map(x => x.id === n.id ? n : x));
        } catch (e) {
            onNotify({ message: `Couldn't change that: ${String(e)}`, type: 'error' });
        }
    };

    // ── What the list shows ──
    const listed = useMemo(() => {
        const titlesOnly = searchQuery.includes('title_search:');
        const q = normalizeText(searchQuery.replace(/title_search:/g, '').replace(/"/g, '').trim());
        return (notes ?? [])
            // The open note as it's being written (its title can change before it's saved).
            .map(n => (draft && n.id === draft.id ? { ...n, title: draft.title, body: draft.body, drives: draft.drives, shared: draft.shared } : n))
            .filter(n => driveFilter === '' ? true : driveFilter === UNASSIGNED ? n.drives.length === 0 : n.drives.some(d => driveCovers(driveFilter, d)))
            .filter(n => !q || normalizeText(titlesOnly ? n.title : `${n.title}\n${n.body}`).includes(q))
            .sort(sorter<Note>(sort, noteDisplayTitle));
    }, [notes, draft, driveFilter, searchQuery, sort]);
    // The workbooks are listed in the same order (the notes inside one keep the order they were put in).
    const sortedBooks = useMemo(() => [...books].sort(sorter<Workbook>(sort, b => b.title)), [books, sort]);

    // With no note open and notes to show, one is opened rather than the page left on its welcome: the note last
    // visited when it's among the ones listed (for the Drive picked), otherwise the first listed (the one changed
    // last). The welcome is for a section, or a Drive, with no notes yet.
    useEffect(() => {
        if (openNoteId || listed.length === 0) return;
        const last = getActiveNoteId();
        onOpenNote(listed.some(n => n.id === last) ? last : listed[0].id);
    }, [openNoteId, listed]); // eslint-disable-line react-hooks/exhaustive-deps

    const openNote = notes?.find(n => n.id === draft?.id) ?? null;
    const sources = useMemo(() => noteSources(draft?.body ?? ''), [draft?.body]);

    const showDrives = flags.showDrive;

    // What the open note cites and links to, and what links to it: a column beside the page on a wide window, and on
    // a narrower one (no room for the column) a panel brought up from the status bar's Sources button.
    const sourcesBody = draft && (
        <>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-2 mb-2">Sources</h3>
            {sources.videos.length === 0 ? (
                <p className="text-[11px] text-gray-600 leading-relaxed">Nothing cited yet. Cite words from a video's transcript or summary, or a moment from its player.</p>
            ) : (
                <ul className="space-y-2.5">
                    {sources.videos.map(v => (
                        <li key={v.id}>
                            <button onClick={() => openInternalLink('video', v.id)} className="text-left text-[13px] text-gray-200 hover:text-white hover:underline decoration-dotted underline-offset-4 cursor-pointer leading-snug">{v.title}</button>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {v.times.length === 0 ? (
                                    <button onClick={() => openInternalLink('video', v.id)} className="rounded cursor-pointer" title="Open the video">
                                        <VideoTag className="hover:bg-[var(--k-accent)]/25 transition-colors" />
                                    </button>
                                ) : v.times.map(t => (
                                    <button key={t} onClick={() => openInternalLink('video', v.id, t)} className="rounded cursor-pointer" title={`Open at ${formatClock(t)}`}>
                                        <TimeTag at={t} className="hover:bg-[var(--k-accent)]/25 transition-colors" />
                                    </button>
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {sources.terms.length > 0 && (
                <>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-5 mb-2">{labels.aliasGlossary}</h3>
                    <div className="flex flex-wrap gap-1.5">
                        {sources.terms.map(t => (
                            <button key={t} onClick={() => openInternalLink('glossary', t)} className="px-1.5 py-0.5 rounded-md border border-[#333] text-[11px] text-gray-300 hover:text-white hover:border-[#505050] cursor-pointer">^{t}</button>
                        ))}
                    </div>
                </>
            )}
            {sources.notes.length > 0 && (
                <>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-5 mb-2">Links to</h3>
                    <ul className="space-y-1">
                        {sources.notes.map(n => (
                            <li key={n.id}>
                                <button onClick={() => onOpenNote(n.id)} className="text-left text-[13px] text-gray-300 hover:text-white cursor-pointer flex items-center gap-1.5">
                                    <NotebookPen className="w-3 h-3 shrink-0 text-gray-500" />{n.title}
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-5 mb-1">Linked from</h3>
            <BacklinksList kind="note" targetKey={draft.id} />
        </>
    );

    return (
        <div className="relative animate-in fade-in slide-in-from-bottom-2 duration-400 flex gap-6 h-full">
            {/* The notes: their name, the Drive filter, the list, and New Note at the bottom (as New Track is in the
                Calendar's panel). Hidden with App's toggle beside the search bar. */}
            {panelOpen && (
            <div className="w-72 min-w-52 shrink h-full flex flex-col">
                <div className="flex items-center gap-2 min-h-9 mb-3 px-1">
                    <h2 className="flex-1 min-w-0 truncate text-xl font-bold text-white">{panelTab === 'workbooks' ? 'Workbooks' : labels.aliasNotes}</h2>
                    <Segmented
                        value={panelTab}
                        onPick={setPanelTab}
                        options={[
                            { value: 'workbooks' as const, label: '', icon: BookOpenText, title: 'Workbooks: Notes in an order, read a page at a time' },
                            { value: 'notes' as const, label: '', icon: NotebookPen, title: `${labels.aliasNotes}: Every note` },
                        ]}
                    />
                </div>
                {panelTab === 'workbooks' ? (
                    <WorkbooksPanel
                        books={sortedBooks}
                        searchQuery={searchQuery}
                        notes={notes ?? []}
                        openBookId={book?.id ?? null}
                        openNoteId={draft?.id ?? null}
                        canShare={flags.allowEditSharedNotes}
                        tracks={canCalendar ? menuTracks : null}
                        onWantTracks={wantTracks}
                        onOpenBook={openBook}
                        onOpenNote={onOpenNote}
                        onNotify={onNotify}
                    />
                ) : (<>
                {showDrives && roots.length > 0 && (
                    <div className="mb-2">
                        <Dropdown
                            width="w-full"
                            button={(open, toggle) => (
                                <button
                                    type="button"
                                    onClick={toggle}
                                    aria-expanded={open}
                                    className="w-full flex items-center justify-between gap-2 bg-[#121212] border border-[#333] hover:border-[#505050] rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer"
                                    title={`Show the notes filed under one ${labels.aliasDriveName} (and the ones beneath it)`}
                                >
                                    <span className={`truncate ${driveFilter ? 'text-white' : 'text-gray-400'}`}>{driveFilter === '' ? `All ${labels.aliasDriveName}s` : driveFilter === UNASSIGNED ? `No ${labels.aliasDriveName}s` : driveLabel(driveFilter)}</span>
                                    <ChevronDown className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                                </button>
                            )}
                        >
                            {close => (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => { setDriveFilter(''); close(); }}
                                        className={`w-full pl-[26px] pr-4 py-2 text-left hover:bg-[#222222] transition-colors cursor-pointer ${driveFilter === '' ? 'text-[var(--k-accent)]' : 'text-gray-200'}`}
                                    >
                                        All {labels.aliasDriveName}s
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setDriveFilter(UNASSIGNED); close(); }}
                                        className={`w-full pl-[26px] pr-4 py-2 text-left hover:bg-[#222222] transition-colors cursor-pointer ${driveFilter === UNASSIGNED ? 'text-[var(--k-accent)]' : 'text-gray-200'}`}
                                    >
                                        No {labels.aliasDriveName}s
                                    </button>
                                    <div className="my-1 border-t border-[#272727]" />
                                    <DriveTreeList roots={roots} isOn={p => p === driveFilter} onPick={p => { setDriveFilter(p); close(); }} checkboxes={false} />
                                </>
                            )}
                        </Dropdown>
                    </div>
                )}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#121212] rounded-xl border border-[#272727] p-1.5 mb-2">
                    {notes === null ? (
                        <p className="px-3 py-2 text-xs text-gray-500">Loading…</p>
                    ) : listed.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-500 leading-relaxed">
                            {notes.length === 0
                                ? 'No notes yet. A note is your own writing on a topic, citing the videos it draws on.'
                                : `No notes match${searchQuery.trim() ? ' your search' : ''}.`}
                        </p>
                    ) : listed.map(n => {
                        const open = n.id === draft?.id;
                        const Mark = n.shared ? Users : User;
                        return (
                            // Resting the pointer on it says when it was last edited and when it was made.
                            <HoverDates key={n.id} title={noteDisplayTitle(n)} rows={editedAndCreated(n)}>{hover => (
                            <div
                                {...hover}
                                role="button"
                                tabIndex={0}
                                onClick={() => onOpenNote(n.id)}
                                onKeyDown={e => { if (e.key === 'Enter') onOpenNote(n.id); }}
                                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); wantTracks(); setNoteMenu({ x: e.clientX, y: e.clientY, note: n }); }}
                                className={`group relative rounded-lg px-3 py-2 cursor-pointer transition-colors ${open ? 'bg-[var(--k-accent)]/10' : noteMenu?.note.id === n.id ? 'bg-[#1e1e1e]' : 'hover:bg-[#1e1e1e]'}`}
                            >
                                {open && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-[var(--k-accent)]" />}
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={`truncate text-sm font-semibold ${n.title.trim() || n.body.trim() ? 'text-gray-100' : 'text-gray-500'}`}>{noteDisplayTitle(n)}</span>
                                    <Mark className="w-3 h-3 shrink-0 text-gray-500" aria-label={n.shared ? 'Shared' : 'Personal'} />
                                    <span className="ml-auto shrink-0 text-[10px] text-gray-500">{whenLabel(n.updatedAt)}</span>
                                    <button
                                        onClick={e => { e.stopPropagation(); wantTracks(); setNoteMenu({ x: e.clientX, y: e.clientY, note: n }); }}
                                        className="p-1 rounded text-gray-500 hover:text-white transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                        title="More actions"
                                    >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {noteSnippet(n) && <p className="text-[12px] text-gray-500 truncate">{noteSnippet(n)}</p>}
                            </div>
                            )}</HoverDates>
                        );
                    })}
                </div>
                {/* New Note is a blank one; the arrow beside it opens the templates a note can start from instead (the
                    app's, then the workspace's own), and saves the open note as one. The menu opens upwards: it's at the
                    foot of the panel. */}
                <div ref={templateMenuRef} className="relative shrink-0 mb-2 flex">
                    <button
                        onClick={() => void newNote()}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-l-lg border text-xs font-bold transition-all cursor-pointer bg-[#121212] border-[#404040] text-gray-400 hover:text-white hover:border-[#505050]"
                        title="Start a new, blank note (personal: Only you have it, until you share it)"
                    >
                        <Plus className="w-3.5 h-3.5" /> New Note
                    </button>
                    <button
                        onClick={() => { setTemplateMenu(o => !o); setTemplateName(null); }}
                        aria-haspopup="menu"
                        aria-expanded={templateMenu}
                        className={`px-2.5 rounded-r-lg border border-l-0 transition-all cursor-pointer bg-[#121212] border-[#404040] hover:text-white hover:border-[#505050] ${templateMenu ? 'text-white' : 'text-gray-400'}`}
                        title="Start a note from a template"
                    >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${templateMenu ? '' : 'rotate-180'}`} />
                    </button>
                    {templateMenu && (
                        <div role="menu" className="absolute left-0 right-0 bottom-full mb-1 z-30 max-h-96 overflow-y-auto custom-scrollbar bg-[#141414] border border-[#333] rounded-xl py-1 shadow-xl text-sm">
                            <p className="px-4 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">New note from</p>
                            {BUILT_IN_TEMPLATES.map(t => (
                                <button key={t.name} type="button" role="menuitem" onClick={() => { setTemplateMenu(false); void newNote(t); }} className="w-full px-4 py-2 text-left text-gray-200 hover:bg-[#222222] transition-colors cursor-pointer truncate">
                                    {t.name}
                                </button>
                            ))}
                            {templates.length > 0 && <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 border-t border-[#272727] mt-1">Yours</p>}
                            {templates.map(t => (
                                <div key={t.name} className="group flex items-center hover:bg-[#222222] transition-colors">
                                    <button type="button" role="menuitem" onClick={() => { setTemplateMenu(false); void newNote(t); }} className="flex-1 min-w-0 px-4 py-2 text-left text-gray-200 cursor-pointer truncate">
                                        {t.name}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { deleteNoteTemplate(t.name).then(setTemplates).catch(() => {}); }}
                                        title={`Delete the template "${t.name}" (notes made from it stay)`}
                                        className="shrink-0 p-1 mr-2 rounded text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            {draft && (
                                <div className="border-t border-[#272727] mt-1 pt-1">
                                    {templateName === null ? (
                                        <button type="button" onClick={() => setTemplateName(noteDisplayTitle(draft).slice(0, MAX_TEMPLATE_NAME))} className="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-[#222222] transition-colors cursor-pointer">
                                            Save This Note as a Template...
                                        </button>
                                    ) : (
                                        <div className="px-3 py-2 flex items-center gap-2">
                                            <input
                                                autoFocus
                                                value={templateName}
                                                onChange={e => setTemplateName(e.target.value)}
                                                onFocus={e => e.currentTarget.select()}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveAsTemplate(); } else if (e.key === 'Escape') { e.stopPropagation(); setTemplateName(null); } }}
                                                onContextMenu={handlePlainContextMenu}
                                                maxLength={MAX_TEMPLATE_NAME}
                                                placeholder="Name the template"
                                                className="flex-1 min-w-0 bg-[#121212] border border-[#333] focus:border-red-600 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none placeholder-gray-600"
                                            />
                                            <button type="button" onClick={() => void saveAsTemplate()} disabled={!templateName.trim()} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default">Save</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                </>)}
            </div>
            )}

            {/* The open note, as a page: the page scrolls, and a workbook's pager stays under it, at the foot of the pane. */}
            <div id="notes-page" className={`flex-1 min-w-0 h-full flex flex-col ${contentThemeStyle ? 'k-content-theme' : ''}`} style={contentThemeStyle}>
            <div ref={notePageRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar pb-10">
                {!draft ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 px-6">
                        <NotebookPen className="w-10 h-10 mb-3 text-gray-600" />
                        <p className="text-lg font-bold text-white mb-1">Write it down, and cite where it came from</p>
                        <p className="text-sm max-w-md leading-relaxed">
                            Open a note, or start a new one. While a video plays, right-click words in its transcript or summary to
                            cite them here, or use <span className="text-gray-300">Cite Moment</span> on the player to note the moment.
                        </p>
                        <button onClick={() => void newNote()} className="mt-4 flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold cursor-pointer">
                            <Plus className="w-4 h-4" /> New note
                        </button>
                    </div>
                ) : (
                    <div className="px-2">
                        <div ref={headRef} className="sticky top-0 z-10 bg-[#0f0f0f] pt-1 pb-3">
                            <input
                                ref={titleRef}
                                value={draft.title}
                                readOnly={!canEdit}
                                onChange={e => setDraft(d => d && { ...d, title: e.target.value })}
                                onContextMenu={handlePlainContextMenu}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setMode('write'); window.setTimeout(() => bodyRef.current?.focus(), 0); } }}
                                placeholder="Untitled"
                                maxLength={200}
                                className="w-full bg-transparent outline-none text-3xl font-bold text-white placeholder-gray-600"
                            />
                            <div className="mt-2 flex items-start gap-3">
                                {/* The note's Drives, wrapping among themselves. min-h: level with the tools beside them. */}
                                <div className="flex-1 min-w-0 min-h-[30px] flex flex-wrap items-center gap-2">
                                {showDrives && draft.drives.map(d => (
                                    <span key={d} className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#333] text-[11px] font-mono text-gray-300">
                                        {d}
                                        {canEdit && (
                                            <button onClick={() => setDraft(x => x && { ...x, drives: x.drives.filter(y => y !== d) })} className="text-gray-500 hover:text-white cursor-pointer" title={`Take it out of ${d}`}>
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {showDrives && canEdit && roots.length > 0 && (
                                    <Dropdown
                                        button={(_open, toggle) => (
                                            <button onClick={toggle} className="px-2 py-0.5 rounded-md border border-dashed border-[#444] text-[11px] text-gray-500 hover:text-white hover:border-[#666] cursor-pointer" title={`File this note under a ${labels.aliasDriveName}, at any level`}>
                                                + {labels.aliasDriveName}
                                            </button>
                                        )}
                                    >
                                        {() => (
                                            <DriveTreeList
                                                roots={roots}
                                                isOn={p => draft.drives.includes(p)}
                                                onPick={p => setDraft(x => x && { ...x, drives: x.drives.includes(p) ? x.drives.filter(y => y !== p) : [...x.drives, p] })}
                                                checkboxes
                                            />
                                        )}
                                    </Dropdown>
                                )}
                                </div>
                                <div className="shrink-0 flex items-center gap-1">
                                    <span className={`text-[11px] mr-1 whitespace-nowrap ${status === 'error' ? 'text-red-400' : 'text-gray-500'}`} title={saveError ?? undefined}>
                                        {!canEdit ? 'Read only' : status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Editing' : status === 'error' ? 'Not saved' : 'Saved'}
                                    </span>
                                    {!panelOpen && (
                                        <button onClick={() => void newNote()} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Start a new note">
                                            <Plus className="w-3.5 h-3.5" /> {!compactTools && 'New Note'}
                                        </button>
                                    )}
                                    <AddToWorkbook noteId={draft.id} books={books} compact={compactTools} onNotify={onNotify} />
                                    {canCalendar && <AddToCalendar noteId={draft.id} compact={compactTools} onDone={(message, ok) => onNotify({ message, type: ok ? 'success' : 'error' })} />}
                                    <button
                                        type="button"
                                        disabled={!flags.allowEditSharedNotes}
                                        onClick={() => (draft.shared ? void setShared(false) : setConfirmShare(true))}
                                        title={!flags.allowEditSharedNotes
                                            ? (draft.shared ? 'A shared note: This workspace doesn\'t let you change shared notes' : 'Personal: Only you have it')
                                            : draft.shared ? 'Shared: It travels with the workspace. Click to make it personal again' : 'Personal: Only you have it. Click to share it with the workspace'}
                                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[#333] text-[11px] font-semibold text-gray-300 hover:text-white hover:border-[#505050] transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-gray-300 disabled:hover:border-[#333]"
                                    >
                                        {draft.shared ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                                        {!compactTools && (draft.shared ? 'Shared' : 'Personal')}
                                    </button>
                                    <Segmented
                                        value={mode}
                                        onPick={setMode}
                                        options={[
                                            ...(canEdit ? [{ value: 'write' as const, label: compactTools ? '' : 'Write', icon: Pencil, title: 'Write: The note in Markdown' }] : []),
                                            { value: 'read' as const, label: compactTools ? '' : 'Read', icon: Eye, title: 'Read: The note as it reads, citations as cards' },
                                        ]}
                                    />
                                    {canEdit && openNote && (
                                        <button onClick={() => askDelete(openNote)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-[#272727] transition-colors cursor-pointer" title="Delete this note">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="mt-3 border-b border-[#272727]" />
                            {/* Ctrl+F, in the part of the page that stays put, so it's there wherever a match is: the
                                search alone for a note being read, Find & Replace for one being written. */}
                            {find.open && (
                                <div ref={find.boxRef} className="mt-3 ml-auto max-w-md">
                                    {mode === 'write' ? (
                                        <FindReplacePanel
                                            anchor="inline"
                                            findText={find.write.findText} setFindText={find.write.setFindText}
                                            replaceText={find.write.replaceText} setReplaceText={find.write.setReplaceText}
                                            matchCase={find.write.matchCase} setMatchCase={find.write.setMatchCase}
                                            matchWholeWord={find.write.matchWholeWord} setMatchWholeWord={find.write.setMatchWholeWord}
                                            matchCount={find.write.searchIndices.length} currentSearchIndex={find.write.currentSearchIndex}
                                            onClose={find.close}
                                            navigateMatch={find.write.navigateMatch}
                                            handleReplace={find.write.handleReplace} handleReplaceAll={find.write.handleReplaceAll}
                                        />
                                    ) : (
                                        <FindReplacePanel
                                            findOnly
                                            anchor="inline"
                                            findText={find.read.findText} setFindText={find.read.setFindText}
                                            replaceText="" setReplaceText={() => {}}
                                            matchCase={find.read.matchCase} setMatchCase={find.read.setMatchCase}
                                            matchWholeWord={find.read.matchWholeWord} setMatchWholeWord={find.read.setMatchWholeWord}
                                            matchCount={find.read.matchCount} currentSearchIndex={find.read.currentIndex}
                                            onClose={find.close}
                                            navigateMatch={find.read.navigateMatch}
                                            handleReplace={() => {}} handleReplaceAll={() => {}}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        {mode === 'write' ? (
                            <div className="relative">
                            {find.writing && find.write.searchIndices.length > 0 && (
                                <FindMirror
                                    mirrorRef={find.mirrorRef}
                                    text={draft.body}
                                    matches={find.write.searchIndices}
                                    current={find.write.currentSearchIndex}
                                    padding={find.padding}
                                    className="text-[15px] leading-relaxed"
                                />
                            )}
                            <textarea
                                ref={bodyRef}
                                // A video picked in Link to, from here, asks whether to link a moment in it (LinkPicker.tsx).
                                {...{ [MENTIONS_ATTR]: '', [NOTE_EDITOR_ATTR]: '', ...(canMakeTerms ? { [NOTE_TERMS_ATTR]: '' } : {}) }}
                                value={draft.body}
                                onChange={e => setDraft(d => d && { ...d, body: e.target.value })}
                                // A [1:30] typed straight after a video link is that link's time: written into the link
                                // (?t=1:30, the form the rest of the app reads) once the writing is left, never while
                                // it's being typed, as the other editors do when they save.
                                onBlur={() => {
                                    typingRef.current = false;
                                    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                    setDraft(d => { const folded = d ? foldVideoLinkTimes(d.body) : ''; return d && folded !== d.body ? { ...d, body: folded } : d; });
                                }}
                                onKeyDown={e => {
                                    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
                                    const isNavigation = e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown';
                                    const isEditingShortcut = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a', 'z', 'y'].includes(e.key.toLowerCase());
                                    if ((!isArrow && !isNavigation && !e.altKey) || isEditingShortcut) {
                                        typingRef.current = true;
                                        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                        typingTimeoutRef.current = setTimeout(() => { typingRef.current = false; }, 100);
                                    }
                                    handleMarkdownKeyDown(e, draft.body, v => setDraft(d => d && { ...d, body: v }));
                                }}
                                onContextMenu={handleMarkdownContextMenu}
                                placeholder={'Write here. Markdown works: # headings, - lists, **bold**.\n\nCite from a video: Select words in its transcript or summary, right-click, Cite in note.\nA "Q:" line with an "A:" line under it reads as a question and its answer (right-click, Question & Answer, writes one).'}
                                className="relative block w-full bg-transparent outline-none resize-none text-[15px] leading-relaxed text-gray-100 placeholder-gray-600"
                            />
                            </div>
                        ) : (
                            // Keyed by the note: each note's answers start covered, whatever was shown in the last one.
                            <div className="k-selectable" data-find-scope>
                                <TaskToggle.Provider value={canEdit ? toggleTask : null}>
                                    <NoteReading key={draft.id} body={draft.body} />
                                </TaskToggle.Provider>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* The open workbook's pages, when the open note is one of them: Previous and Next, where this page is, and a
                box to go to any page by its number. Outside the page's scroll, so it's always at the foot of the pane,
                however short or long the note is. */}
            {draft && book && book.noteIds.includes(draft.id) && (() => {
                const at = book.noteIds.indexOf(draft.id);
                const total = book.noteIds.length;
                const go = (i: number) => onOpenNote(book.noteIds[Math.min(Math.max(i, 0), total - 1)]);
                const turn = 'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold text-gray-200 hover:bg-[#333] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent';
                return (
                    <div className="shrink-0 mb-2 border-t border-[#272727] bg-[#0f0f0f]">
                        <div className="px-2 pt-2 flex items-center gap-2">
                            <button type="button" disabled={at === 0} onClick={() => go(at - 1)} className={turn}><ChevronLeft className="w-3.5 h-3.5" /> Previous</button>
                            <span className="flex-1 min-w-0 flex items-center justify-center gap-2 text-[11px] text-gray-400">
                                <BookOpenText className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />
                                <span className="truncate font-semibold text-gray-200">{book.title}</span>
                                <span className="shrink-0 tabular-nums">
                                    Page
                                    <input
                                        key={draft.id}
                                        defaultValue={at + 1}
                                        inputMode="numeric"
                                        aria-label={`Page, 1 to ${total}`}
                                        onFocus={e => e.currentTarget.select()}
                                        onChange={e => { const d = e.target.value.replace(/[^0-9]/g, ''); e.target.value = d ? String(Math.min(Math.max(Number(d), 1), total)) : ''; }}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const n = Number(e.currentTarget.value); if (n) go(n - 1); } }}
                                        onBlur={e => { e.currentTarget.value = String(at + 1); }}
                                        onContextMenu={handlePlainContextMenu}
                                        className="w-9 mx-1.5 px-1 py-0.5 rounded bg-[#1a1a1a] border border-[#333] focus:border-[#555] text-center text-white outline-none"
                                    />
                                    of {total}
                                </span>
                            </span>
                            <button type="button" disabled={at === total - 1} onClick={() => go(at + 1)} className={turn}>Next <ChevronRight className="w-3.5 h-3.5" /></button>
                        </div>
                    </div>
                );
            })()}
            </div>

            {/* What the open note cites and links to, and what links to it: the column... */}
            {draft && (
                <div className="hidden xl:block w-64 shrink-0 h-full overflow-y-auto custom-scrollbar border-l border-[#272727] pl-4 pb-10">
                    {sourcesBody}
                </div>
            )}
            {/* ...and, where the window is too narrow for it, the same as a panel over the page's right edge. */}
            {draft && sourcesOpen && (
                <div
                    ref={sourcesPanelRef}
                    className="xl:hidden absolute top-0 right-0 bottom-0 z-20 w-72 max-w-[85%] overflow-y-auto custom-scrollbar bg-[#0f0f0f] border-l border-[#303030] shadow-2xl shadow-black pl-4 pr-3 pb-10 animate-in fade-in slide-in-from-right-4 duration-150"
                >
                    <button onClick={() => setSourcesOpen(false)} aria-label="Close" title="Close" className="absolute top-1.5 right-2 p-1 rounded-md text-gray-500 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                    </button>
                    {sourcesBody}
                </div>
            )}

            <BottomBar>
                <div className="flex items-center gap-6 flex-1 min-w-0 text-[11px] font-semibold text-gray-400">
                    <div className={`flex items-center gap-6 min-w-0 ${panelOpen ? 'w-72 shrink-0' : ''}`}>
                        <span className="shrink-0 whitespace-nowrap">
                            <span className="text-white">{listed.length}</span>
                            {listed.length !== (notes?.length ?? 0) ? ` of ${notes?.length ?? 0}` : ''} note{(notes?.length ?? 0) === 1 ? '' : 's'}
                        </span>
                        {draft && (
                            <span className={`flex items-center gap-4 whitespace-nowrap ${panelOpen ? 'ml-auto' : ''}`}>
                                <span><span className="text-white">{wordCount(draft.body)}</span> words</span>
                                <span><span className="text-white">{citationCount(draft.body)}</span> citation{citationCount(draft.body) === 1 ? '' : 's'}</span>
                            </span>
                        )}
                    </div>
                    <div className="ml-auto flex items-stretch self-stretch gap-4 shrink-0">
                        {/* The order of the list beside the page, notes or workbooks: drawn as the Library's sort buttons
                            are (VideoList.tsx), a name beside each icon where the bar has the room. */}
                        {flags.showSortControls && (
                            <div className="flex items-stretch border-x border-[#272727] px-1">
                                {SORT_FIELDS.map(({ field, label, title, icon: Icon }) => (
                                    <button
                                        key={field}
                                        type="button"
                                        // A date starts newest first, a name A to Z.
                                        onClick={() => setSort({ field, order: field === sort.field ? sort.order : field === 'title' ? 'asc' : 'desc' })}
                                        title={`Sort by ${title}`}
                                        className={`px-1.5 py-0.5 text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${sort.field === field ? 'bg-[#303030] text-white' : 'text-gray-400 hover:text-white hover:bg-[#272727]'}`}
                                    >
                                        <Icon className="w-3 h-3" />
                                        <span className="hidden @3xl:inline">{label}</span>
                                    </button>
                                ))}
                                <div className="w-px h-3 self-center bg-[#272727] mx-0.5" />
                                <button
                                    type="button"
                                    onClick={() => setSort({ ...sort, order: sort.order === 'desc' ? 'asc' : 'desc' })}
                                    title="Sort Order ↑ ↓"
                                    className="px-1.5 py-0.5 text-gray-400 hover:text-white hover:bg-[#272727] transition-all cursor-pointer group flex items-center gap-1"
                                >
                                    {sort.order === 'desc'
                                        ? <ArrowDown className="w-3.5 h-3.5 group-active:translate-y-0.5 transition-transform" />
                                        : <ArrowUp className="w-3.5 h-3.5 group-active:-translate-y-0.5 transition-transform" />}
                                </button>
                            </div>
                        )}
                        {draft && (
                            <button
                                type="button"
                                onClick={find.open ? find.close : find.show}
                                title={mode === 'write' ? 'Find and replace in this note (Ctrl+F)' : 'Find in this note (Ctrl+F)'}
                                className={`flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer hover:bg-[#272727] ${find.open ? 'text-white bg-[#272727]' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Search className="w-3 h-3" /> <span className="hidden @3xl:inline">Find</span>
                            </button>
                        )}
                        {/* Only where the Sources column has no room (it shows from xl up): brings the same up as a panel. */}
                        {draft && (
                            <button
                                ref={sourcesButtonRef}
                                type="button"
                                onClick={() => setSourcesOpen(o => !o)}
                                aria-expanded={sourcesOpen}
                                title="What this note cites and links to, and what links to it"
                                className={`xl:hidden flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer hover:bg-[#272727] ${sourcesOpen ? 'text-white bg-[#272727]' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Library className="w-3 h-3" /> Sources
                                {sources.videos.length > 0 && <span className="text-white">{sources.videos.length}</span>}
                            </button>
                        )}
                        <TrashChip kind="note" labelFrom="2xl" onOpen={onOpenTrash} />
                    </div>
                </div>
            </BottomBar>

            {noteMenu && <ContextMenu x={noteMenu.x} y={noteMenu.y} items={noteMenuItems(noteMenu.note)} onClose={closeNoteMenu} />}
            {toShare && (
                <ConfirmDialog
                    title="Share This Note?"
                    confirmLabel="Share"
                    message={`A shared note travels with the workspace: Anyone you hand the workspace to (a Kinpak) gets "${noteDisplayTitle(toShare)}". It stays where it is on your Calendar.\n\nYou can make it personal again later.`}
                    onConfirm={() => void shareOther(toShare, true)}
                    onCancel={() => setToShare(null)}
                />
            )}
            {toDelete && (
                <ConfirmDialog
                    message={`Delete the note "${noteDisplayTitle(toDelete)}"? It goes to the Trash, and links to it become plain words.`}
                    onConfirm={() => void remove(toDelete)}
                    onCancel={() => setToDelete(null)}
                />
            )}
            {makingTerm && draft && (
                <MakeTermModal
                    request={makingTerm}
                    drives={draft.drives}
                    onClose={() => setMakingTerm(null)}
                    onMade={term => {
                        setMakingTerm(null);
                        onNotify({ message: `"${term}" added to the ${labels.aliasGlossary}`, type: 'success', action: { label: 'Open', onClick: () => openInternalLink('glossary', term) } });
                    }}
                />
            )}
            {confirmShare && (
                <ConfirmDialog
                    title="Share This Note?"
                    confirmLabel="Share"
                    message={'A shared note travels with the workspace: Anyone you hand the workspace to (a Kinpak) gets it. It stays where it is on your Calendar.\n\nYou can make it personal again later.'}
                    onConfirm={() => void setShared(true)}
                    onCancel={() => setConfirmShare(false)}
                />
            )}
        </div>
    );
}
