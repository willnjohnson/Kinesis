import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import {
    Bold, BookA, ChevronRight, ClipboardPaste, Code, Copy, GalleryVerticalEnd, Highlighter, Image as ImageIcon, Italic, Link, Link2, List, ListChecks,
    ListOrdered, MessageCircleQuestionMark, Minus, Quote, RemoveFormatting, Scissors, Sigma, Strikethrough, Table,
} from 'lucide-react';
import {
    applyHeading, applyMarkdownAction, headingLevelAt, insertCallout, insertMath, MARKDOWN_MENU_EVENT, selectionIsWrapped,
    type MarkdownAction, type MarkdownMenuRequest,
} from '../lib/markdown-editor';
import { stripMarkdownFormatting } from '../lib/markdown-format';
import { readClipboardText } from '../api';
import { MENU_DIVIDER, MENU_PANEL, MENU_ROW } from './ContextMenu';
import { NOTE_EDITOR_ATTR } from './LinkPicker';

const mod = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const shift = mod === '⌘' ? '⇧' : 'Shift+';
const alt = mod === '⌘' ? '⌥' : 'Alt+';

// The inline formats sit in one row of icons (like a small toolbar), the heading levels in another.
const INLINE: { action: MarkdownAction; label: string; hint: string; Icon: ElementType }[] = [
    { action: 'bold', label: 'Bold', hint: `${mod}B`, Icon: Bold },
    { action: 'italic', label: 'Italic', hint: `${mod}I`, Icon: Italic },
    { action: 'strikethrough', label: 'Strikethrough', hint: `${mod}${shift}X`, Icon: Strikethrough },
    { action: 'highlight', label: 'Highlight', hint: `${mod}H`, Icon: Highlighter },
    { action: 'code', label: 'Code', hint: `${mod}E`, Icon: Code },
];
const HEADINGS = [1, 2, 3, 4, 5, 6];

type Field = HTMLTextAreaElement | HTMLInputElement;
type Row<T extends Field = HTMLTextAreaElement> = {
    label: string; hint: string; Icon: ElementType; run: (t: T) => void;
    /** More of the same kind, in a panel beside the menu while the row is pointed at (Quote's callouts). `callout`: the
     *  kind's mark ("NOTE"), for one that can also be made to fold (in a note). */
    more?: (Row<T> & { color: string; callout?: string })[];
    /** Its panel is the maths one (MATH_TABS below) rather than a list of `more`. */
    math?: boolean;
};
const act = (label: string, hint: string, Icon: ElementType, action: MarkdownAction): Row => ({
    label, hint, Icon, run: (t) => applyMarkdownAction(t, action),
});

const LINK = act('Link', `${mod}K`, Link, 'link');
const LINK_TO = act('Link to...', `${mod}${shift}K`, Link2, 'linkToApp');
const IMAGE = act('Image', `${mod}L`, ImageIcon, 'image');
// Quote/Callout opens a panel of its kinds: the regular quote (single and multi), and the callouts (lib/remark-callouts.ts), each with the
// color it's drawn in. In a note, the panel is headed by how a callout behaves (CALLOUT_STYLES below): the kind picked
// is written that way.
const QUOTE: Row = {
    ...act('Quote/Callout', `${mod}${shift}.`, Quote, 'blockquote'),
    more: [
        { ...act('Regular (Single Quote)', '', Quote, 'blockquoteSingle'), color: '' },
        { ...act('Regular (Multi-Quote)', '', Quote, 'blockquoteMulti'), color: '' },
        { ...act('Note', '', Quote, 'calloutNote'), color: '#3b82f6', callout: 'NOTE' },
        { ...act('Tip', '', Quote, 'calloutTip'), color: '#22c55e', callout: 'TIP' },
        { ...act('Important', '', Quote, 'calloutImportant'), color: '#a855f7', callout: 'IMPORTANT' },
        { ...act('Warning', '', Quote, 'calloutWarning'), color: '#eab308', callout: 'WARNING' },
        { ...act('Caution', '', Quote, 'calloutCaution'), color: '#ef4444', callout: 'CAUTION' },
    ],
};
// How a callout behaves, chosen at the head of that panel in a note (the only place a callout folds): always shown, or
// collapsible and starting folded or revealed. The sign is what's written after the mark (`> [!NOTE]-`).
const CALLOUT_STYLES = [
    { style: 'standard', label: 'Standard', sign: '', title: 'A callout that is always shown' },
    { style: 'folded', label: 'Folded', sign: '-', title: 'Collapsible: Starts folded, and its title opens it' },
    { style: 'revealed', label: 'Revealed', sign: '+', title: 'Collapsible: Starts open, and its title folds it' },
] as const;
type CalloutStyle = typeof CALLOUT_STYLES[number]['style'];
const BULLETS = act('Bulleted list', `${mod}${shift}L`, List, 'bulletList');
const NUMBERS = act('Numbered list', `${mod}${shift}7`, ListOrdered, 'numberedList');
const TASKS = act('Task list', `${mod}T`, ListChecks, 'taskList');
const TABLE = act('Table', `${mod}${shift}T`, Table, 'table');
const RULE = act('Horizontal rule', `${mod}${shift}H`, Minus, 'horizontalRule');
const CLEAR = act('Clear formatting', '', RemoveFormatting, 'clearFormatting');
// Only in a note (the Notes section's editor), which draws a "Q:" line and the "A:" line under it as a block
// (lib/remark-qa.ts). The hint is what it writes, where the others show their shortcut, so the menu also teaches that
// the lines can simply be typed.
const QA = act('Question & Answer', 'Q: / A:', MessageCircleQuestionMark, 'questionAnswer');
// Also only in a note: a link that opens the Glossary's flashcards for a Drive (picked in the Link to pane's
// Flashcards tab), so a note on a subject can point at the terms to go over.
const FLASHCARDS = act('Flashcards...', '', GalleryVerticalEnd, 'linkFlashcards');
// Also only in a note, which draws LaTeX between dollar signs (lib/note-math.ts): the row itself starts a formula (or
// makes the selected text one), and its panel has the pieces a formula is mostly made of, under four tabs. The hint is
// what it writes, as Question & Answer's is.
const MATH: Row = { label: 'Math & Formulas', hint: '$ ... $', Icon: Sigma, run: t => insertMath(t, '', { wrap: 'inline' }), math: true };
/** A piece of a formula: what it's called, the LaTeX it writes, and the part of that left selected to type over. In a
 *  grid (Greek, Symbols) it's shown as `glyph`, the character itself; in a list, by its name with its LaTeX beside it. */
type MathPiece = { label: string; latex: string; select?: string; glyph?: string; wrap?: 'inline' | 'block' };
const MATH_TABS: { tab: string; grid?: boolean; pieces: MathPiece[] }[] = [
    {
        tab: 'Basic',
        pieces: [
            { label: 'Formula in a line', latex: '$ ... $', wrap: 'inline' },
            { label: 'Formula on its own lines', latex: '$$ ... $$', wrap: 'block' },
            { label: 'Fraction', latex: '\\frac{a}{b}', select: 'a' },
            { label: 'Power', latex: 'x^{2}', select: '2' },
            { label: 'Subscript', latex: 'x_{i}', select: 'i' },
            { label: 'Square root', latex: '\\sqrt{x}', select: 'x' },
            { label: 'Nth root', latex: '\\sqrt[n]{x}', select: 'n' },
            { label: 'Words in a formula', latex: '\\text{words}', select: 'words' },
        ],
    },
    {
        tab: 'Calculus',
        pieces: [
            { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i', select: 'x_i' },
            { label: 'Product', latex: '\\prod_{i=1}^{n} x_i', select: 'x_i' },
            { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx', select: 'f(x)' },
            { label: 'Limit', latex: '\\lim_{x \\to \\infty} f(x)', select: 'f(x)' },
            { label: 'Derivative', latex: '\\frac{dy}{dx}', select: 'dy' },
            { label: 'Partial derivative', latex: '\\frac{\\partial f}{\\partial x}', select: 'f' },
            { label: 'Vector', latex: '\\vec{v}', select: 'v' },
            { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', select: 'a & b \\\\ c & d' },
        ],
    },
    {
        tab: 'Greek',
        grid: true,
        pieces: [
            ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['θ', 'theta'],
            ['λ', 'lambda'], ['μ', 'mu'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'],
            ['φ', 'phi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'], ['Γ', 'Gamma'], ['Δ', 'Delta'],
            ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Π', 'Pi'], ['Σ', 'Sigma'], ['Φ', 'Phi'], ['Ω', 'Omega'],
        ].map(([glyph, name]) => ({ glyph, label: name[0].toUpperCase() + name.slice(1) + (name[0] === name[0].toUpperCase() ? ' (capital)' : ''), latex: `\\${name}` })),
    },
    {
        tab: 'Symbols',
        grid: true,
        pieces: [
            ['±', 'pm', 'Plus or minus'], ['×', 'times', 'Times'], ['÷', 'div', 'Divided by'], ['·', 'cdot', 'Dot'], ['≠', 'neq', 'Not equal'], ['≈', 'approx', 'About equal'],
            ['≤', 'leq', 'At most'], ['≥', 'geq', 'At least'], ['∞', 'infty', 'Infinity'], ['→', 'to', 'To'], ['⇒', 'Rightarrow', 'Implies'], ['⇔', 'Leftrightarrow', 'If and only if'],
            ['∈', 'in', 'In'], ['∉', 'notin', 'Not in'], ['⊂', 'subset', 'Subset of'], ['∪', 'cup', 'Union'], ['∩', 'cap', 'Intersection'], ['∅', 'emptyset', 'Empty set'],
            ['∀', 'forall', 'For all'], ['∃', 'exists', 'There exists'], ['∴', 'therefore', 'Therefore'], ['∝', 'propto', 'Proportional to'], ['°', 'circ', 'Degree (as a power: ^\\circ)'], ['…', 'dots', 'Dots'],
        ].map(([glyph, name, label]) => ({ glyph, label, latex: `\\${name}` })),
    },
];

// And, over a selection in a note: a Glossary term made of it (its name when it's a few words, its definition when
// it's more), where the workspace lets terms be added (the note's editor says so with NOTE_TERMS_ATTR).
const MAKE_TERM = act('Make Glossary Term...', '', BookA, 'makeTerm');
export const NOTE_TERMS_ATTR = 'data-note-terms';
/** On a field that draws emphasis and nothing else (a log's Description: bold, italic, struck, highlighted). Over a
 *  selection there, the menu is those four and Cut / Copy / Paste: no code, headings, links or lists, which the field
 *  would show as the characters they're typed as. */
export const EMPHASIS_ONLY_ATTR = 'data-emphasis-only';
const isNote = (field: Field): field is HTMLTextAreaElement => field instanceof HTMLTextAreaElement && field.hasAttribute(NOTE_EDITOR_ATTR);
const CUT: Row<Field> = { label: 'Cut', hint: `${mod}X`, Icon: Scissors, run: () => { document.execCommand('cut'); } };
const COPY: Row<Field> = { label: 'Copy', hint: `${mod}C`, Icon: Copy, run: () => { document.execCommand('copy'); } };
// Reads the clipboard through the app, not navigator.clipboard (which makes the webview ask the user for permission).
// If it can't be read, nothing is pasted (Ctrl+V still works).
const PASTE: Row<Field> = {
    label: 'Paste', hint: `${mod}V`, Icon: ClipboardPaste,
    run: (t) => {
        readClipboardText()
            .then(text => { if (text) { t.focus(); document.execCommand('insertText', false, text); } })
            .catch(() => { /* couldn't read it */ });
    },
};

/** What the menu offers depends on what it was opened over, so it only lists things that make sense there:
 *   - Over selected text: formatting for that text. Blocks that stand on their own line (table, rule) aren't
 *     offered, "Clear formatting" only when the text has formatting to clear, and Cut/Copy/Paste at the end.
 *   - On an empty line: what can start a line (headings, lists, quote, table, rule, image, links) and Paste.
 *     There is no text to bold, so no inline formats.
 *   - Plain (see plainRows): no formatting at all.
 *  In a note, each also offers Question & Answer: the selected text made into one, or an empty one to fill in. */
function layoutFor(request: MarkdownMenuRequest & { textarea: HTMLTextAreaElement }): { inline: boolean; groups: Row[][] } {
    const note = isNote(request.textarea);
    if (request.kind === 'blank') {
        return {
            inline: false,
            groups: [
                [QUOTE, BULLETS, NUMBERS, TASKS],
                [TABLE, RULE, ...(note ? [QA, FLASHCARDS, MATH] : [])],
                [LINK, LINK_TO, IMAGE],
                [PASTE],
            ],
        };
    }
    const selected = request.textarea.value.substring(request.start, request.end);
    if (request.textarea.hasAttribute(EMPHASIS_ONLY_ATTR)) {
        return { inline: true, groups: [...(stripMarkdownFormatting(selected) !== selected ? [[CLEAR]] : []), [CUT, COPY, PASTE]] };
    }
    return {
        inline: true,
        groups: [
            [LINK, LINK_TO, IMAGE],
            [QUOTE, BULLETS, NUMBERS, TASKS, ...(note ? [QA, FLASHCARDS, MATH] : [])],
            ...(note && request.textarea.hasAttribute(NOTE_TERMS_ATTR) && selected.trim() ? [[MAKE_TERM]] : []),
            ...(stripMarkdownFormatting(selected) !== selected ? [[CLEAR]] : []),
            [CUT, COPY, PASTE],
        ],
    };
}

/** The plain menu, for a field without markdown (or a spot in a markdown one where no formatting applies): Cut and
 *  Copy with text selected, and Paste unless the field is read-only. */
function plainRows(request: MarkdownMenuRequest): Row<Field>[] {
    const hasSelection = request.start !== request.end;
    const writable = !request.textarea.readOnly;
    return [
        ...(hasSelection && writable ? [CUT] : []),
        ...(hasSelection ? [COPY] : []),
        ...(writable ? [PASTE] : []),
    ];
}

/** In a note, the plain menu (a right-click in a line of text, nothing selected) offers Question & Answer too: an empty
 *  one, added under that line. It's the menu most right-clicks in a note get, so the one where it's looked for. */
const plainNoteRow = (request: MarkdownMenuRequest): Row | null =>
    request.kind === 'plain' && request.start === request.end && isNote(request.textarea) && !request.textarea.readOnly ? QA : null;

const MENU_WIDTH = 232;
const PLAIN_MENU_WIDTH = 180;
// The panel a row's further choices open in, beside the menu.
const FLY_WIDTH = 232;
// And in a note, where it's headed by Standard / Folded / Revealed.
const STYLED_FLY_WIDTH = 232;
// Math & Formulas' panel: four tabs wide, and as tall as its longest tab (eight rows under the tabs).
const MATH_FLY_WIDTH = 264;
const MATH_FLY_HEIGHT = 8 * 32 + 52;
const EDGE = 8;

/**
 * The right-click menu in a markdown editor, over selected text or an empty line (see layoutFor for
 * what each offers), and the plain Cut / Copy / Paste one in other text fields. Mounted once in App; fields
 * only ask for it (handleMarkdownContextMenu / handlePlainContextMenu in lib/markdown-editor.ts).
 */
export function MarkdownContextMenu() {
    const [request, setRequest] = useState<MarkdownMenuRequest | null>(null);
    // The row whose further choices are showing in a panel beside the menu (Quote's kinds), and where that row is on
    // screen: the panel is its own box, outside the menu's (which scrolls, and would cut it off).
    const [opened, setOpened] = useState<{ label: string; row: DOMRect; menu: DOMRect } | null>(null);
    // How the callout picked from Quote/Callout's panel is written (a note's panel has the choice at its head).
    const [calloutStyle, setCalloutStyle] = useState<CalloutStyle>('standard');
    // The tab showing in Math & Formulas' panel (kept from one opening of the menu to the next: whoever is writing
    // Greek letters wants that tab again).
    const [mathTab, setMathTab] = useState(MATH_TABS[0].tab);
    useEffect(() => { setOpened(null); setCalloutStyle('standard'); }, [request]);
    const ref = useRef<HTMLDivElement>(null);
    const flyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onRequest = (e: Event) => setRequest((e as CustomEvent<MarkdownMenuRequest>).detail);
        window.addEventListener(MARKDOWN_MENU_EVENT, onRequest);
        return () => window.removeEventListener(MARKDOWN_MENU_EVENT, onRequest);
    }, []);

    useEffect(() => {
        if (!request) return;
        const close = () => setRequest(null);
        const onMouseDown = (e: globalThis.MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node) && !flyRef.current?.contains(e.target as Node)) close();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', close);
        window.addEventListener('blur', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', close);
            window.removeEventListener('blur', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [request]);

    // Keeps the whole menu on screen. It is measured once drawn (before the browser paints), so the
    // size never has to be guessed: near the bottom it opens upwards from the pointer, near the right
    // edge it opens leftwards, and if the window is too short it scrolls.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!request || !el) return;
        const { width, height } = el.getBoundingClientRect();
        let left = request.x;
        let top = request.y;
        if (left + width > window.innerWidth - EDGE) left = window.innerWidth - width - EDGE;
        if (top + height > window.innerHeight - EDGE) {
            top = request.y - height >= EDGE ? request.y - height : window.innerHeight - height - EDGE;
        }
        el.style.left = `${Math.max(EDGE, left)}px`;
        el.style.top = `${Math.max(EDGE, top)}px`;
    }, [request]);

    if (!request) return null;

    const run = <T extends Field>(field: T, fn: (t: T) => void) => {
        const { start, end } = request;
        setRequest(null);
        // The click took focus off the editor; put the selection back so the action applies to it.
        // Preserve scroll position of the nearest scrollable ancestor to prevent jumping.
        const scrollable = (field as HTMLElement).closest('.overflow-y-auto') as HTMLElement | null;
        const scrollTop = scrollable?.scrollTop ?? 0;
        try {
            field.focus({ preventScroll: true } as any);
        } catch {
            field.focus();
        }
        field.setSelectionRange(start, end);
        fn(field);
        // Restore immediately and again after next ticks to be robust
        if (scrollable) {
            scrollable.scrollTop = scrollTop;
            requestAnimationFrame(() => { scrollable.scrollTop = scrollTop; });
            setTimeout(() => { scrollable.scrollTop = scrollTop; }, 0);
            setTimeout(() => { scrollable.scrollTop = scrollTop; }, 10);
        }
    };

    // The row that opened the panel, for the panel's own rows (they act on the same field).
    let flyout: ReactNode = null;
    const rowButton = <T extends Field>(field: T, row: Row<T>) => {
        const isOpen = opened?.label === row.label;
        if (row.math && isOpen && opened && field instanceof HTMLTextAreaElement) {
            // The maths panel: its tabs across the top (the one showing underlined, as the callout's styles are), then
            // that tab's pieces, as a list of names or, for letters and symbols, a grid of the characters themselves.
            const area: HTMLTextAreaElement = field;
            const shown = MATH_TABS.find(t => t.tab === mathTab) ?? MATH_TABS[0];
            const right = opened.menu.right + MATH_FLY_WIDTH + EDGE <= window.innerWidth;
            const pick = (p: MathPiece) => run(area, t => insertMath(t, p.wrap ? '' : p.latex, { select: p.select, wrap: p.wrap }));
            flyout = (
                <div
                    ref={flyRef}
                    style={{
                        left: right ? opened.menu.right + 2 : opened.menu.left - MATH_FLY_WIDTH - 2,
                        top: Math.max(EDGE, Math.min(opened.row.top - 5, window.innerHeight - MATH_FLY_HEIGHT - EDGE)),
                        width: MATH_FLY_WIDTH,
                    }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`fixed z-[301] ${MENU_PANEL}`}
                >
                    <div className="flex gap-0.5">
                        {MATH_TABS.map(t => (
                            <button
                                key={t.tab}
                                onClick={() => setMathTab(t.tab)}
                                aria-pressed={shown.tab === t.tab}
                                className={`flex-1 h-7 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${shown.tab === t.tab ? 'text-white' : 'text-gray-400 hover:bg-[#272727] hover:text-white'}`}
                            >
                                <span className={`pb-0.5 border-b-2 ${shown.tab === t.tab ? 'border-[var(--k-accent)]' : 'border-transparent'}`}>{t.tab}</span>
                            </button>
                        ))}
                    </div>
                    <div className={MENU_DIVIDER} />
                    {shown.grid ? (
                        <div className="grid grid-cols-6 gap-0.5">
                            {shown.pieces.map(p => (
                                <button
                                    key={p.latex}
                                    onClick={() => pick(p)}
                                    title={`${p.label}: ${p.latex}`}
                                    aria-label={p.label}
                                    className="h-8 rounded-lg text-[15px] text-gray-200 hover:bg-[#272727] hover:text-white transition-colors cursor-pointer"
                                >
                                    {p.glyph}
                                </button>
                            ))}
                        </div>
                    ) : shown.pieces.map(p => (
                        <button key={p.label} onClick={() => pick(p)} className={`${MENU_ROW} text-gray-200`}>
                            <span className="flex-1 min-w-0 truncate text-left">{p.label}</span>
                            <span className="shrink-0 max-w-[55%] truncate font-mono text-[10px] text-[#666666]">{p.latex}</span>
                        </button>
                    ))}
                </div>
            );
        }
        if (row.more && isOpen && opened) {
            // Beside the menu, level with the row: to the right where there's room, otherwise to the left; and pulled
            // up where it would run off the bottom.
            // In a note, a callout can fold: the panel is headed by that choice, and is wider for it.
            const styled = isNote(field) && row.more.some(sub => sub.callout);
            const width = styled ? STYLED_FLY_WIDTH : FLY_WIDTH;
            const height = row.more.length * 32 + 10 + (styled ? 42 : 0);
            const right = opened.menu.right + width + EDGE <= window.innerWidth;
            const sign = CALLOUT_STYLES.find(s => s.style === calloutStyle)?.sign ?? '';
            flyout = (
                <div
                    ref={flyRef}
                    style={{
                        left: right ? opened.menu.right + 2 : opened.menu.left - width - 2,
                        top: Math.max(EDGE, Math.min(opened.row.top - 5, window.innerHeight - height - EDGE)),
                        width,
                    }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`fixed z-[301] ${MENU_PANEL}`}
                >
                    {styled && (
                        <>
                            <div className="flex gap-0.5">
                                {CALLOUT_STYLES.map(s => (
                                    <button
                                        key={s.style}
                                        onClick={() => setCalloutStyle(s.style)}
                                        title={s.title}
                                        aria-pressed={calloutStyle === s.style}
                                        className={`flex-1 h-7 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${calloutStyle === s.style ? 'text-white' : 'text-gray-400 hover:bg-[#272727] hover:text-white'}`}
                                    >
                                        {/* The one chosen is said by a line of the accent under its name, not by a filled button. */}
                                        <span className={`pb-0.5 border-b-2 ${calloutStyle === s.style ? 'border-[var(--k-accent)]' : 'border-transparent'}`}>{s.label}</span>
                                    </button>
                                ))}
                            </div>
                            <div className={MENU_DIVIDER} />
                        </>
                    )}
                    {row.more.map(sub => {
                        // A regular quote doesn't fold: with a collapsible style chosen, it's not on offer.
                        const off = styled && sign !== '' && !sub.callout;
                        return (
                            <button
                                key={sub.label}
                                disabled={off}
                                onClick={() => run(field, styled && sub.callout && sign ? (t => insertCallout(t as HTMLTextAreaElement, sub.callout!, sign)) : sub.run)}
                                // Grayed where it isn't on offer (the theme's muted text; its color class has to be the
                                // only one, since the theme's own rule for text-gray-200 would win over a `disabled:` one).
                                className={`${MENU_ROW} ${off ? 'text-gray-500' : 'text-gray-200'}`}
                            >
                                {/* No dot for the regular quote (it has no color of its own); its place is kept, so the names line up. */}
                                <span className="w-2 h-2 rounded-full shrink-0" style={sub.color ? { backgroundColor: sub.color } : undefined} />
                                <span className="flex-1 text-left">{sub.label}</span>
                            </button>
                        );
                    })}
                </div>
            );
        }
        return (
            <button
                key={row.label}
                onClick={() => run(field, row.run)}
                // Pointing at a row with more opens its panel; pointing at any other row puts the panel away.
                onMouseEnter={(e) => {
                    const menu = ref.current?.getBoundingClientRect();
                    setOpened((row.more || row.math) && menu ? { label: row.label, row: e.currentTarget.getBoundingClientRect(), menu } : null);
                }}
                aria-haspopup={row.more || row.math ? 'menu' : undefined}
                aria-expanded={row.more || row.math ? isOpen : undefined}
                className={`${MENU_ROW} text-gray-200 ${isOpen ? 'bg-[#272727]' : ''}`}
            >
                <row.Icon className="w-3.5 h-3.5 text-[#aaaaaa] shrink-0" />
                <span className="flex-1 text-left">{row.label}</span>
                <span className="text-[10px] text-[#666666]">{row.hint}</span>
                {(row.more || row.math) && <ChevronRight className="w-3 h-3 text-[#666666]" />}
            </button>
        );
    };

    const shell = (width: number, children: ReactNode) => (
        <>
        <div
            ref={ref}
            style={{ left: request.x, top: request.y, width, maxHeight: `calc(100vh - ${EDGE * 2}px)` }}
            // Keep the editor focused while the menu is used. And keep the click to ourselves: a popover the field sits
            // in (say, the Drive icon picker's filter) closes on a mousedown outside it, which would take the field away
            // before Paste could reach it.
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onContextMenu={(e) => e.preventDefault()}
            className={`fixed z-[300] overflow-y-auto ${MENU_PANEL}`}
        >
            {children}
        </div>
        {flyout}
        </>
    );

    if (request.kind === 'plain') {
        const field = request.textarea;
        const qa = plainNoteRow(request);
        return shell(qa ? MENU_WIDTH : PLAIN_MENU_WIDTH, (
            <>
                {plainRows(request).map(row => rowButton(field, row))}
                {qa && isNote(field) && (
                    <>
                        <div className={MENU_DIVIDER} />
                        {rowButton(field, qa)}
                        {rowButton(field, FLASHCARDS)}
                        {rowButton(field, MATH)}
                    </>
                )}
            </>
        ));
    }

    const textarea = request.textarea;
    const { inline, groups } = layoutFor(request);
    const selected = textarea.value.substring(request.start, request.end);
    // Which heading (if any) the line is already, so choosing it again can remove it.
    const currentHeading = headingLevelAt(textarea);
    const emphasisOnly = textarea.hasAttribute(EMPHASIS_ONLY_ATTR);

    const toggleClass = (on: boolean) =>
        on ? 'bg-red-600 text-white' : 'text-[#cccccc] hover:bg-[#272727] hover:text-white';

    return shell(MENU_WIDTH, (
        <>
            {inline && (
                <div className="flex gap-0.5">
                    {INLINE.filter(f => !emphasisOnly || f.action !== 'code').map(({ action, label, hint, Icon }) => {
                        const on = selectionIsWrapped(selected, action);
                        return (
                            <button
                                key={action}
                                onClick={() => run(textarea, (t) => applyMarkdownAction(t, action))}
                                title={`${label} (${hint})`}
                                aria-label={label}
                                aria-pressed={on}
                                className={`flex-1 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${toggleClass(on)}`}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                        );
                    })}
                </div>
            )}
            {!emphasisOnly && <div className={`flex gap-0.5 ${inline ? 'mt-0.5' : ''}`}>
                {HEADINGS.map(level => (
                    <button
                        key={level}
                        onClick={() => run(textarea, (t) => applyHeading(t, level))}
                        title={`Heading ${level} (${alt}${level})`}
                        aria-label={`Heading ${level}`}
                        aria-pressed={currentHeading === level}
                        className={`flex-1 h-8 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${toggleClass(currentHeading === level)}`}
                    >
                        H{level}
                    </button>
                ))}
            </div>}
            {groups.map((group, g) => (
                <div key={g}>
                    <div className={MENU_DIVIDER} />
                    {group.map(row => rowButton(textarea, row))}
                </div>
            ))}
        </>
    ));
}
