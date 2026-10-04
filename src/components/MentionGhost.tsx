import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getBiographies, getGlossaryTerms } from '../api';
import { buildLink } from '../lib/internal-links';
import { useFlags } from '../hooks/useFlags';

/** The attribute that opts a markdown textarea in (MarkdownField, the Sidebar's Summary and Transcript editors). */
export const MENTIONS_ATTR = 'data-mentions';

/** Something a mention can complete to: what's typed is matched against `text`, `hint` is shown faintly after it, and
 *  `link` is what replaces the mention when it's taken. */
interface Suggestion { text: string; hint: string; link: string }

interface Ghost {
    el: HTMLTextAreaElement;
    /** Where the "@" or "^" is, and the caret (the end of what's typed after it). */
    at: number;
    caret: number;
    matches: Suggestion[];
    pick: number;
    /** The textarea's box in the window, the styles its text is laid out with, and how far it's scrolled. */
    box: DOMRect;
    layout: CSSProperties;
    scrollTop: number;
}

// The mark at the start of the text, or after a space or an opening bracket/quote (so an email address doesn't count),
// then what's typed after it so far. A handle has no spaces; a Glossary term can ("^bitcoin hal").
const BIO_MENTION = /(^|[\s([{"'])@([A-Za-z0-9._-]*)$/;
const TERM_MENTION = /(^|[\s([{"'])\^([^\n^@[\]]*)$/;

/**
 * Mentions in the markdown editors: "@" for a Biography, "^" for a Glossary term. While the caret sits right after the
 * mark and the start of a name, at the end of a line, the rest of the first one that starts that way is drawn faintly
 * after it (like the Library search's ghost text, components/SearchBar.tsx), a handle with the person's name. Enter or
 * Tab takes it, turning "@rossmanngroup" into `[Louis Rossmann](kinesis://bio/RossmannGroup)` and "^abdomen" into
 * `[Abdomen](kinesis://glossary/Abdomen)`, the same links the Link to... picker writes. Up/Down step through the others
 * that fit, Esc hides it until something else is typed. Each is off where the workspace hides its section.
 *
 * Mounted once in App, like MarkdownContextMenu: it follows whichever opted-in textarea has focus. It's drawn on the page
 * over the textarea, so the textarea itself is untouched. Only at a line's end, since there it can't cover any text.
 * Accepting goes through the browser's own insertText, so Ctrl+Z takes it back like typing.
 */
export function MentionGhost() {
    const { flags } = useFlags();
    const [ghost, setGhost] = useState<Ghost | null>(null);
    const ghostRef = useRef<Ghost | null>(null);
    ghostRef.current = ghost;
    const people = useRef<Suggestion[]>([]);
    const terms = useRef<Suggestion[]>([]);
    const loadedAt = useRef(0);
    // The mention Esc was pressed on ("mark position:typed"), hidden until it changes.
    const dismissed = useRef<string | null>(null);
    const pick = useRef(0);
    const bios = flags.showBiography;
    const glossary = flags.showGlossary;

    useEffect(() => {
        if (!bios && !glossary) { setGhost(null); return; }
        let frame = 0;

        const compute = () => {
            frame = 0;
            const el = document.activeElement;
            if (!(el instanceof HTMLTextAreaElement) || !el.hasAttribute(MENTIONS_ATTR) || el.selectionStart !== el.selectionEnd) {
                setGhost(null);
                return;
            }
            const caret = el.selectionStart;
            const next = el.value[caret];
            if (next !== undefined && next !== '\n') { setGhost(null); return; }
            const before = el.value.slice(0, caret);
            const bio = bios ? BIO_MENTION.exec(before) : null;
            const term = !bio && glossary ? TERM_MENTION.exec(before) : null;
            const m = bio ?? term;
            if (!m) { setGhost(null); return; }
            const typed = m[2];
            const at = caret - typed.length - 1;
            const key = `${at}:${typed}`;
            if (dismissed.current === key) { setGhost(null); return; }
            if (dismissed.current && !dismissed.current.startsWith(`${at}:`)) dismissed.current = null;
            const lower = typed.toLowerCase();
            const matches = (bio ? people : terms).current.filter(s => s.text.toLowerCase().startsWith(lower));
            if (matches.length === 0) { setGhost(null); return; }
            const prev = ghostRef.current;
            if (!prev || prev.el !== el || prev.at !== at || prev.caret !== caret) pick.current = 0;
            setGhost({ el, at, caret, matches, pick: pick.current % matches.length, box: el.getBoundingClientRect(), layout: layoutOf(el), scrollTop: el.scrollTop });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(compute); };

        // The names are read when an editor gets focus (at most every few seconds), so one added meanwhile shows up.
        const byText = (a: Suggestion, b: Suggestion) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' });
        const isEditor = (el: EventTarget | Element | null): el is HTMLTextAreaElement =>
            el instanceof HTMLTextAreaElement && el.hasAttribute(MENTIONS_ATTR);
        const loadNames = () => {
            if (Date.now() - loadedAt.current <= 5000) return;
            loadedAt.current = Date.now();
            if (bios) {
                getBiographies()
                    .then(rows => {
                        people.current = rows
                            .map(r => ({ handle: r.handle.trim().replace(/^@/, ''), name: r.displayName.trim() }))
                            .filter(p => p.handle !== '')
                            .map(p => ({ text: p.handle, hint: p.name, link: buildLink(p.name || p.handle, 'bio', p.handle) }))
                            .sort(byText);
                        schedule();
                    })
                    .catch(() => {});
            }
            if (glossary) {
                getGlossaryTerms()
                    .then(rows => {
                        // Terms only (a Quick Tag has no definition to open), each name once however many Drives define it,
                        // as in the Link to... picker.
                        const names = new Set(rows.filter(r => r.definition.trim() !== '').map(r => r.term.trim()).filter(Boolean));
                        terms.current = [...names].map(t => ({ text: t, hint: '', link: buildLink(t, 'glossary', t) })).sort(byText);
                        schedule();
                    })
                    .catch(() => {});
            }
        };
        const onFocus = (e: FocusEvent) => {
            if (!isEditor(e.target)) return;
            loadNames();
            schedule();
        };

        const onKey = (e: KeyboardEvent) => {
            const g = ghostRef.current;
            if (!g || e.target !== g.el || e.ctrlKey || e.altKey || e.metaKey) return;
            const take = () => { e.preventDefault(); e.stopPropagation(); };
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                take();
                g.el.focus();
                g.el.setSelectionRange(g.at, g.caret);
                document.execCommand('insertText', false, g.matches[g.pick].link);
                setGhost(null);
            } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && g.matches.length > 1) {
                take();
                pick.current = (g.pick + (e.key === 'ArrowDown' ? 1 : g.matches.length - 1)) % g.matches.length;
                setGhost({ ...g, pick: pick.current });
            } else if (e.key === 'Escape') {
                take();
                dismissed.current = `${g.at}:${g.el.value.slice(g.at + 1, g.caret)}`;
                setGhost(null);
            }
        };

        document.addEventListener('focusin', onFocus);
        document.addEventListener('focusout', schedule);
        document.addEventListener('selectionchange', schedule);
        document.addEventListener('input', schedule, true);
        document.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        // Capture, on the document: ahead of the editor's own Enter (list continuation) and Tab (indent) handling.
        document.addEventListener('keydown', onKey, true);
        // Which sections are shown changed while an editor already has focus: read the names now, not at the next focus.
        loadedAt.current = 0;
        if (isEditor(document.activeElement)) loadNames();
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('focusout', schedule);
            document.removeEventListener('selectionchange', schedule);
            document.removeEventListener('input', schedule, true);
            document.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [bios, glossary]);

    if (!ghost) return null;
    const match = ghost.matches[ghost.pick];
    const typed = ghost.el.value.slice(ghost.at + 1, ghost.caret);
    const { box } = ghost;
    return createPortal(
        // A see-through copy of the textarea laid exactly over it: the same box, padding, font and wrapping, holding the
        // text up to the caret (invisible) and then the ghost. So the ghost lands right where the next typed letter would,
        // measured by the browser's own layout rather than worked out by hand.
        <div
            aria-hidden
            // Above the dialogs an editor can be in (z-100), below menus and confirmations (z-200+).
            className="fixed z-[150] pointer-events-none overflow-hidden"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height, color: 'transparent', ...ghost.layout }}
        >
            {/* Scrolled with the textarea: its padding stays put and the text moves, as in the textarea. */}
            <div style={{ transform: `translateY(${-ghost.scrollTop}px)` }}>
                {ghost.el.value.slice(0, ghost.caret)}
                {/* nowrap: it stays on the caret's line (clipped at the edge) rather than spilling onto the next one. */}
                <span className="whitespace-nowrap">
                    <span className="text-gray-500">{match.text.slice(typed.length)}</span>
                    <span className="text-gray-600">
                        {match.hint ? `  ${match.hint}` : ''}
                        {ghost.matches.length > 1 ? `  ${ghost.pick + 1}/${ghost.matches.length}` : ''}
                    </span>
                </span>
            </div>
        </div>,
        document.body,
    );
}

/** The styles a textarea lays its text out with, for a copy to wrap it identically. Its scrollbar (if it has one) takes
 *  width from the text, so the copy gets that much more padding on the right. */
function layoutOf(el: HTMLTextAreaElement): CSSProperties {
    const s = getComputedStyle(el);
    const borderX = (parseFloat(s.borderLeftWidth) || 0) + (parseFloat(s.borderRightWidth) || 0);
    const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth - borderX);
    return {
        boxSizing: 'border-box',
        borderStyle: 'solid',
        borderColor: 'transparent',
        borderTopWidth: s.borderTopWidth, borderRightWidth: s.borderRightWidth, borderBottomWidth: s.borderBottomWidth, borderLeftWidth: s.borderLeftWidth,
        paddingTop: s.paddingTop, paddingLeft: s.paddingLeft, paddingBottom: s.paddingBottom,
        paddingRight: `${(parseFloat(s.paddingRight) || 0) + scrollbar}px`,
        fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle,
        fontFeatureSettings: s.fontFeatureSettings, fontVariantLigatures: s.fontVariantLigatures,
        letterSpacing: s.letterSpacing, wordSpacing: s.wordSpacing, lineHeight: s.lineHeight, tabSize: s.tabSize as CSSProperties['tabSize'],
        textIndent: s.textIndent, textTransform: s.textTransform as CSSProperties['textTransform'],
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: s.wordBreak as CSSProperties['wordBreak'],
    };
}
