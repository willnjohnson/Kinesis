import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useFindReplace } from './sidebar/useFindReplace';
import { useReadFind } from './sidebar/useReadFind';

/** The note as it's read, in the Notes section's page: where Ctrl+F looks while reading. */
export const NOTE_FIND_SCOPE = '#notes-page [data-find-scope]';

/** Whether a window, a menu's backdrop or the video sidebar is over the page (the same test App's Esc makes): Ctrl+F
 *  is then theirs, or nobody's, and not the note's underneath. */
function somethingOnTop(): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>('div.fixed.inset-0'))
        .some(el => el.id !== 'k-life' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

/** Scrolls the nearest scrolling ancestor so `el` sits mid-view (the page scrolls, not the note's box). */
function scrollToMiddle(el: Element) {
    let box: HTMLElement | null = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (!box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = top - box.clientHeight / 2;
}

/**
 * Ctrl+F in the Notes section, for the note that's open. While reading, it's the search the Sidebar has for a
 * transcript (useReadFind): the matches are marked in the page and stepped through, and nothing changes. While
 * writing, it's Find & Replace on the note's text (useFindReplace), with the matches marked behind the text
 * (FindMirror below), since a text box shows no selection while the typing is in the Find box.
 *
 * Neither outlives its note or its mode. Esc closes it from its own box or from the note's text.
 */
export function useNoteFind({ enabled, noteId, mode, body, setBody, bodyRef }: {
    /** A note is open. */
    enabled: boolean;
    noteId: string | null;
    mode: 'write' | 'read';
    body: string;
    setBody: (body: string) => void;
    bodyRef: RefObject<HTMLTextAreaElement | null>;
}) {
    const [reading, setReading] = useState(false);
    const noBackdrop = useRef<HTMLDivElement>(null);
    const write = useFindReplace({
        isEditingTranscript: true,
        editedTranscript: body, editedSummary: '',
        setEditedTranscript: setBody, setEditedSummary: () => {},
        transcriptEditRef: bodyRef, summaryEditRef: bodyRef,
        transcriptBackdropRef: noBackdrop, summaryBackdropRef: noBackdrop,
    });
    const read = useReadFind(reading, body, NOTE_FIND_SCOPE);
    const { showFindReplace: writing, setShowFindReplace: setWriting } = write;
    const open = mode === 'write' ? writing : reading;
    const boxRef = useRef<HTMLDivElement>(null);
    const mirrorRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setReading(false); setWriting(false); }, [noteId, mode, enabled, setWriting]);

    const show = useCallback(() => {
        if (mode === 'write') setWriting(true);
        else setReading(true);
        // Already open: back into its box with the text selected, like a browser's find.
        requestAnimationFrame(() => {
            const input = boxRef.current?.querySelector('input');
            input?.focus();
            input?.select();
        });
    }, [mode, setWriting]);
    const close = useCallback(() => {
        setReading(false);
        setWriting(false);
        if (mode === 'write') bodyRef.current?.focus();
    }, [mode, setWriting, bodyRef]);

    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
                if (!somethingOnTop()) show();
                return;
            }
            if (e.key !== 'Escape' || !open || e.defaultPrevented) return;
            const at = e.target as Node | null;
            if (!at || !(boxRef.current?.contains(at) || at === bodyRef.current)) return;
            e.preventDefault();
            e.stopPropagation();
            close();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [enabled, open, show, close, bodyRef]);

    // The marks behind the text sit where the text does: inside the text box's own padding.
    const [padding, setPadding] = useState('');
    useLayoutEffect(() => {
        if (writing && bodyRef.current) setPadding(getComputedStyle(bodyRef.current).padding);
    }, [writing, bodyRef]);

    // The current match is brought into view when the search or the place in it changes, not when the note's text
    // does: typing in the note with Find open would otherwise throw the page back to the first match at every key.
    const lastBody = useRef(body);
    useEffect(() => {
        const typed = lastBody.current !== body;
        lastBody.current = body;
        if (!writing || typed) return;
        const mark = mirrorRef.current?.querySelector('[data-current]');
        if (mark) scrollToMiddle(mark);
    }, [writing, write.currentSearchIndex, write.searchIndices, body]);

    return { open, show, close, reading, writing, read, write, boxRef, mirrorRef, padding };
}

/**
 * The matches of a search in a text box, drawn behind its text: the same text, unseen, laid out the same way (the
 * caller gives it the box's font and the box's padding), with each match on a tint and the current one on a stronger
 * one. The box itself sits over it, see-through.
 */
export function FindMirror({ mirrorRef, text, matches, current, padding, className }: {
    mirrorRef: RefObject<HTMLDivElement | null>;
    text: string;
    matches: { start: number; end: number }[];
    current: number;
    padding: string;
    /** The text box's own type: its size and line height. */
    className: string;
}) {
    const parts: React.ReactNode[] = [];
    let at = 0;
    matches.forEach((m, i) => {
        if (m.start > at) parts.push(text.slice(at, m.start));
        parts.push(
            <mark key={i} {...(i === current ? { 'data-current': '' } : {})} className={`rounded-sm text-transparent ${i === current ? 'bg-blue-500/50' : 'bg-yellow-400/35'}`}>
                {text.slice(m.start, m.end)}
            </mark>,
        );
        at = m.end;
    });
    parts.push(text.slice(at));
    return (
        <div ref={mirrorRef} aria-hidden style={{ padding }} className={`absolute inset-0 pointer-events-none whitespace-pre-wrap break-words text-transparent select-none ${className}`}>
            {parts}
        </div>
    );
}
