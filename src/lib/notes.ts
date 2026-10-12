import { useEffect, useState } from 'react';
import { appendToNote, getNote, NOTES_CHANGED_EVENT, type Note } from '../api';
import { buildVideoLink, foldVideoLinkTimes, openInternalLink } from './internal-links';
import { parseClock } from './remark-timestamps';

/**
 * The Notes section's shared parts (components/NotesView.tsx is the section itself): the active note that the cite
 * commands write into, citations as Markdown, and what a note's text cites (its Sources column).
 *
 * A citation is plain Markdown, so it reads anywhere and needs nothing stored of its own:
 *
 *     > You form the Perfekt with haben for most verbs.
 *     >
 *     > — [Past Tenses, Lecture 5](kinesis://video/abc123?t=12:34)
 *
 * The quote is a copy of the words, so editing the transcript or making a new summary never breaks it; the link is an
 * ordinary video link, so renaming or deleting the video keeps it tidy (src-tauri/src/db/links.rs). A note shows a quote
 * ending in such a line as a card (NotesView's CitationCard).
 */

// ── The active note ──────────────────────────────────────────────────────────

const ACTIVE_KEY = 'kinesis.notes.active';
/** Fired (on window) when the active note changes. */
export const ACTIVE_NOTE_EVENT = 'kinesis:active-note';

/** The note the cite commands write into: the one last opened or written in. Remembered in this browser, as a reader's
 *  convenience (a stale id from another workspace simply finds no note). */
export function getActiveNoteId(): string | null {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveNoteId(id: string | null) {
    try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* just not remembered */ }
    window.dispatchEvent(new Event(ACTIVE_NOTE_EVENT));
}

/** The active note as it is now (null when there's none, or it's gone), kept current as notes change. */
export function useActiveNote(): Note | null {
    const [note, setNote] = useState<Note | null>(null);
    useEffect(() => {
        let live = true;
        const load = () => {
            const id = getActiveNoteId();
            if (!id) { setNote(null); return; }
            getNote(id).then(n => { if (live) setNote(n); }).catch(() => { if (live) setNote(null); });
        };
        load();
        window.addEventListener(ACTIVE_NOTE_EVENT, load);
        window.addEventListener(NOTES_CHANGED_EVENT, load);
        return () => {
            live = false;
            window.removeEventListener(ACTIVE_NOTE_EVENT, load);
            window.removeEventListener(NOTES_CHANGED_EVENT, load);
        };
    }, []);
    return note;
}

// ── Workbooks ────────────────────────────────────────────────────────────────

/** Fired (on window) to open a workbook in the Notes section (a workbook link, the palette). */
export const OPEN_WORKBOOK_EVENT = 'kinesis:open-workbook';
let requestedWorkbook: { id: string; noteId?: string } | null = null;

/** Asks the Notes section to open a workbook. Kept until it's taken, since the section may not be on screen yet (the
 *  caller switches to it): it takes what's waiting when it mounts, and hears the event when it's already there. */
export function requestWorkbook(id: string, noteId?: string) {
    requestedWorkbook = { id, noteId };
    window.dispatchEvent(new Event(OPEN_WORKBOOK_EVENT));
}

/** The workbook asked for, once. */
export function takeRequestedWorkbook(): { id: string; noteId?: string } | null {
    const asked = requestedWorkbook;
    requestedWorkbook = null;
    return asked;
}

/** Opens a note from a Calendar entry: as a page of the workbook it was added from (so Previous and Next are there),
 *  or on its own when it wasn't added from one. A workbook that's gone, or no longer holds the note, changes nothing:
 *  the note opens either way. */
export function openCalendarNote(noteId: string, workbookId: string | null) {
    if (workbookId) requestWorkbook(workbookId, noteId);
    openInternalLink('note', noteId);
}

// ── Citing ───────────────────────────────────────────────────────────────────

/** A quote and where it's from, as Markdown (see the module notes). `at`: the moment it was said, in seconds. */
export function buildCitation(quote: string, videoTitle: string, videoId: string, at?: number): string {
    const lines = quote.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => `> ${l}`);
    return [...lines, '>', `> — ${buildVideoLink(videoTitle || videoId, videoId, at)}`].join('\n');
}

/** A moment in a video and the thought written about it ("Cite Moment"): a citation like buildCitation's, the thought as
 *  the quote (its paragraphs kept apart) and the moment as its source. With nothing written, the video's link on a line
 *  of its own, which a note shows as the video with its time after it (NotesView's VideoReference). The link's words
 *  are the title alone: the time is in its address, and is drawn from there. */
export function buildMomentNote(videoTitle: string, videoId: string, at: number, thought = ''): string {
    const link = buildVideoLink(videoTitle || videoId, videoId, Math.floor(at));
    if (!thought.trim()) return link;
    // Blank lines between paragraphs stay, as one empty quote line each.
    const lines = thought.trim().split(/\r?\n/).map(l => l.trim()).filter((l, i, all) => l || all[i - 1]).map(l => (l ? `> ${l}` : '>'));
    return [...lines, '>', `> — ${THOUGHT_MARK} ${link}`].join('\n');
}

/** The word between the dash and the link in a thought's source line ("— on [Talk](…)"): what tells the reader's own
 *  words about a moment from words quoted out of the video ("— [Talk](…)"), in the text and in how a note draws it. */
export const THOUGHT_MARK = 'on';

/** Fired (on window) to add text to a note. The Notes section, when it has that note open, takes it into what's being
 *  written (setting `handled`), so it never races a save in progress; otherwise it's appended to the stored note. */
export const NOTE_APPEND_EVENT = 'kinesis:note-append';
export interface NoteAppendRequest { id: string; text: string; handled: boolean }

/** Adds `text` to the end of a note, as a paragraph of its own. */
export async function citeIntoNote(id: string, text: string): Promise<void> {
    const request: NoteAppendRequest = { id, text, handled: false };
    window.dispatchEvent(new CustomEvent<NoteAppendRequest>(NOTE_APPEND_EVENT, { detail: request }));
    if (!request.handled) await appendToNote(id, text);
}

/** `body` with `text` after it as a paragraph of its own (the backend's join_paragraphs does the same). */
export function joinParagraphs(body: string, text: string): string {
    const before = body.replace(/\s+$/, '');
    return before ? `${before}\n\n${text.trim()}` : text.trim();
}

/** Where a selection in the transcript starts: the last timestamp written before it ("[12:34]" or a "12:34" chip), in
 *  seconds. A summary usually has none, so its citations have no time. */
export function lastTimeBefore(textBefore: string): number | undefined {
    const all = [...textBefore.matchAll(/(?:^|[^\d:])((?:\d{1,2}:)?\d{1,2}:[0-5]\d)(?![\d:])/g)];
    const last = all[all.length - 1]?.[1];
    if (!last) return undefined;
    const parts = last.split(':').map(Number);
    const seconds = parts.reduce((total, n) => total * 60 + n, 0);
    return Number.isFinite(seconds) ? seconds : undefined;
}

// ── Reading a note ───────────────────────────────────────────────────────────

/** What a note is called in a list: its title, else its first line of words, else "Untitled". */
export function noteDisplayTitle(note: Pick<Note, 'title' | 'body'>): string {
    if (note.title.trim()) return note.title.trim();
    const first = note.body.split('\n').map(plainLine).find(Boolean);
    return first ? first.slice(0, 80) : 'Untitled';
}

/** A note's first line of words that isn't its title, for under its name in the list. */
export function noteSnippet(note: Pick<Note, 'title' | 'body'>): string {
    const lines = note.body.split('\n').map(plainLine).filter(Boolean);
    const first = note.title.trim() ? lines[0] : lines[1];
    return (first ?? '').slice(0, 120);
}

/** A line of Markdown as plain words: links to their text, without heading, quote and list marks. */
function plainLine(line: string): string {
    return line
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/[*_=`~]+/g, '')
        .trim();
}

export function wordCount(body: string): number {
    return body.replace(/\]\([^)]*\)/g, ']').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/** How many citations (a quote ending in "— [video link]") a note holds. */
export function citationCount(body: string): number {
    return (body.match(/^>\s*— (?:on )?\[[^\]]*\]\(kinesis:\/\/video\//gm) ?? []).length;
}

export interface NoteSources {
    /** Each video it links (cites), in the order first seen, with the moments it cites, in seconds. A link's time can be
     *  written as a clock ("1:27") or as plain seconds ("87"): either way it's the one moment, shown as a clock. */
    videos: { id: string; title: string; times: number[] }[];
    /** Each glossary term it links. */
    terms: string[];
    /** Each note it links: id and the link's words. */
    notes: { id: string; title: string }[];
}

/** What a note's text points at, for its Sources column. Worked out from the text each time, never stored. */
export function noteSources(body: string): NoteSources {
    const out: NoteSources = { videos: [], terms: [], notes: [] };
    // A moment can also be written as a timestamp straight after the link ([Talk](kinesis://video/ID)[1:30]), which
    // the page reads as the link's own time: read here the same way, or such a link would count as the whole video.
    for (const m of foldVideoLinkTimes(body).matchAll(/\[([^[\]]*)\]\(kinesis:\/\/(video|glossary|note)\/([A-Za-z0-9\-._~%]+)(?:\?t=([0-9:]+))?\)/g)) {
        let key: string;
        try { key = decodeURIComponent(m[3]); } catch { continue; }
        const text = m[1].trim();
        if (m[2] === 'video') {
            let v = out.videos.find(x => x.id === key);
            if (!v) {
                // A moment link's words are "12:34 · Title": the title is what follows the time.
                v = { id: key, title: text.replace(/^(?:\d{1,2}:)?\d{1,2}:[0-5]\d\s*·\s*/, '') || key, times: [] };
                out.videos.push(v);
            }
            const at = m[4] ? parseClock(m[4]) : null;
            if (at !== null && !v.times.includes(at)) v.times.push(at);
        } else if (m[2] === 'glossary') {
            if (!out.terms.some(t => t.toLowerCase() === key.toLowerCase())) out.terms.push(key);
        } else if (!out.notes.some(n => n.id === key)) {
            out.notes.push({ id: key, title: text || 'Untitled' });
        }
    }
    return out;
}
