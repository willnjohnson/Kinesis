import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, Check, GalleryVerticalEnd, RotateCcw, Shuffle, X } from 'lucide-react';
import { SecondaryButton } from './ui/Button';
import { Select } from './ui/Select';
import { Segmented } from './ui/Segmented';
import type { GlossaryTerm } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { Modal } from './Modal';
import { MarkdownLink } from './MarkdownLink';
import { remarkHighlight } from '../lib/remark-highlight';
import { remarkTimestamps } from '../lib/remark-timestamps';
import { markdownUrlTransform } from '../lib/internal-links';
import { prefersReducedMotion } from '../lib/transitions';

type Front = 'term' | 'definition';
/** How a card has been sorted. Not sorted is no entry at all. */
type Mark = 'know' | 'learning';
/** Which cards the deck shows. */
type Show = 'all' | Mark | 'unsorted';

const MARK_LABEL: Record<Mark, string> = { learning: 'Still learning', know: 'Know it' };

/** What a card is remembered by: its term and the Drives it's filed under (a term can have a definition per Drive). */
const cardKey = (e: GlossaryTerm) => `${e.term.toLowerCase()}|${e.drives.join(',')}`;

// Sorting is the reader's own progress, remembered on this computer per workspace (like a pin, not workspace content).
const storageKey = (workspace: string) => `kinesis.flashcards.${workspace}`;
function loadMarks(workspace: string): Map<string, Mark> {
    try {
        const raw = JSON.parse(localStorage.getItem(storageKey(workspace)) ?? '{}') as Record<string, string>;
        return new Map(Object.entries(raw).filter((kv): kv is [string, Mark] => kv[1] === 'know' || kv[1] === 'learning'));
    } catch {
        return new Map();
    }
}
function saveMarks(workspace: string, marks: Map<string, Mark>) {
    try { localStorage.setItem(storageKey(workspace), JSON.stringify(Object.fromEntries(marks))); } catch { /* just not remembered */ }
}

/**
 * The card's number in "X / Total": click it to type another and Enter jumps there. Digits only, kept in range as it's
 * typed (0 becomes 1, past the end becomes the last). Esc or clicking away leaves it as it was.
 */
function CardNumber({ at, total, onJump }: { at: number; total: number; onJump: (index: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    if (draft === null) {
        return (
            <button
                type="button"
                onClick={() => setDraft(String(at + 1))}
                title="Go to a card"
                className="text-white font-semibold rounded px-1 -mx-1 hover:bg-[#2a2a2a] cursor-text transition-colors"
            >
                {at + 1}
            </button>
        );
    }
    const clamp = (text: string) => {
        const digits = text.replace(/\D/g, '');
        if (digits === '') return '';
        return String(Math.max(1, Math.min(total, Number(digits))));
    };
    return (
        <input
            autoFocus
            onFocus={e => e.currentTarget.select()}
            inputMode="numeric"
            aria-label={`Card number, 1 to ${total}`}
            value={draft}
            onChange={e => setDraft(clamp(e.target.value))}
            onBlur={() => setDraft(null)}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (draft !== '') onJump(Number(draft) - 1);
                    setDraft(null);
                } else if (e.key === 'Escape') {
                    // Only the number: the Flashcards stay open.
                    e.preventDefault();
                    setDraft(null);
                }
            }}
            style={{ width: `${String(total).length + 1}ch` }}
            className="bg-[#121212] border border-[#404040] focus:border-red-600 focus:outline-none rounded text-white font-semibold text-center tabular-nums px-0.5"
        />
    );
}

/** A side of the card: the term (large, centred) or its definition (as the Glossary shows it, scrolling when long). */
function Face({ side, entry, back }: { side: Front; entry: GlossaryTerm; back: boolean }) {
    return (
        <div
            className="absolute inset-0 rounded-2xl border border-[#303030] bg-[#141414] flex flex-col"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: back ? 'rotateY(180deg)' : undefined }}
        >
            <span className="absolute top-3 left-4 text-[10px] font-bold uppercase tracking-widest text-gray-500">{side === 'term' ? 'Term' : 'Definition'}</span>
            {side === 'term' ? (
                <div className="flex-1 flex items-center justify-center p-10">
                    <span className="text-3xl font-bold text-white text-center leading-tight break-words">{entry.term}</span>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-8 pt-10 pb-6 flex">
                    {/* my-auto: a short definition sits in the middle; a long one starts at the top and scrolls. A link in it
                        works as a link (it doesn't flip the card). */}
                    <div className="my-auto w-full leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-code:text-red-400" onClick={e => { if ((e.target as Element).closest('a, button')) e.stopPropagation(); }}>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkHighlight, [remarkTimestamps, { chips: false }]]}
                            urlTransform={markdownUrlTransform}
                            components={{ a: MarkdownLink }}
                        >
                            {entry.definition}
                        </ReactMarkdown>
                    </div>
                </div>
            )}
        </div>
    );
}


/**
 * Flashcards from the Glossary's terms (the ones on screen: all of them, or one Drive's), Quizlet-style: a card shows the
 * term, and clicking it (or Space) flips it to the definition. Either side can be the one shown first.
 *
 * Each card can be sorted, with the dropdown under it, into Still learning or Know it, or back to Not sorted (keys: 1 and
 * 2 sort and move on, 0 un-sorts). The Show dropdown narrows the deck to one of those groups, so going over what's still
 * being learned is a matter of showing just those. Sorting is remembered on this computer, per workspace. The deck is
 * taken when the filter is picked: sorting a card while showing Still learning doesn't make it vanish mid-way.
 */
/** Where a deck was left (this run of the app only): Back to Flashcards picks up there. Which deck it was, by its name and
 *  cards, so a different deck never takes another's place. */
let saved: { deck: string; front: Front; show: Show; order: number[]; at: number } | null = null;

export function FlashcardsModal({ entries, deckName, resume = false, onClose }: {
    entries: GlossaryTerm[];
    deckName: string;
    /** Opened by Back/Forward: as it was left (side, filter, order, card), not from the first card. */
    resume?: boolean;
    onClose: () => void;
}) {
    const deck = `${deckName}|${entries.map(cardKey).join(',')}`;
    const from = resume && saved?.deck === deck && saved.order.every(i => i < entries.length) ? saved : null;
    const { labels } = useWorkspace();
    const workspace = labels.workspaceName;
    const [marks, setMarksState] = useState<Map<string, Mark>>(() => loadMarks(workspace));
    const setMark = (e: GlossaryTerm, m: Mark | null) => {
        setMarksState(prev => {
            const next = new Map(prev);
            if (m) next.set(cardKey(e), m); else next.delete(cardKey(e));
            saveMarks(workspace, next);
            return next;
        });
    };
    const markOf = (e: GlossaryTerm): Mark | undefined => marks.get(cardKey(e));

    const [front, setFront] = useState<Front>(from?.front ?? 'term');
    const [show, setShow] = useState<Show>(from?.show ?? 'all');
    const fits = (e: GlossaryTerm, s: Show) => (s === 'all' ? true : s === 'unsorted' ? !markOf(e) : markOf(e) === s);
    const deckFor = (s: Show) => entries.map((_, i) => i).filter(i => fits(entries[i], s));
    // The deck (indexes into `entries`), in the order shown.
    const [order, setOrder] = useState<number[]>(() => from?.order ?? entries.map((_, i) => i));
    const [at, setAt] = useState(from?.at ?? 0);
    // Kept as it goes, so leaving any way (a link, Back, the X) leaves it ready to pick up.
    useEffect(() => { saved = { deck, front, show, order, at }; }, [deck, front, show, order, at]);
    const [flipped, setFlipped] = useState(false);
    const animate = useMemo(() => !prefersReducedMotion(), []);
    const total = order.length;
    const card = total > 0 ? entries[order[Math.min(at, total - 1)]] : undefined;
    const back: Front = front === 'term' ? 'definition' : 'term';
    const count = (s: Show) => entries.filter(e => fits(e, s)).length;

    // A new card always shows its front first.
    const go = (to: number) => { setFlipped(false); setAt(Math.max(0, Math.min(total - 1, to))); };
    const pick = (s: Show) => { setShow(s); setOrder(deckFor(s)); setFlipped(false); setAt(0); };
    const shuffle = () => {
        const next = [...order];
        for (let i = next.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [next[i], next[j]] = [next[j], next[i]];
        }
        setOrder(next);
        go(0);
    };

    // Sort the card shown. In All terms it stays where it is. Showing only some, a card sorted out of them leaves the
    // deck there and then, and the next one takes its place (the last one gone: the one before it).
    const keyMark = (m: Mark | null) => {
        if (!card) return;
        setMark(card, m);
        const stillFits = show === 'all' || (show === 'unsorted' ? m === null : m === show);
        if (stillFits) return;
        const next = order.filter((_, i) => i !== at);
        setOrder(next);
        setFlipped(false);
        setAt(Math.max(0, Math.min(at, next.length - 1)));
    };
    const keyMarkRef = useRef(keyMark);
    keyMarkRef.current = keyMark;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Already handled (the card number's Enter, which has closed its box by the time this runs).
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
            // Not while a dropdown has focus: its own keys.
            // Nor while typing a card number: its digits and Enter are its own.
            const tag = (document.activeElement as HTMLElement | null)?.tagName;
            if (tag === 'SELECT' || tag === 'INPUT') return;
            if (e.key === 'ArrowRight') { e.preventDefault(); setFlipped(false); setAt(a => Math.min(total - 1, a + 1)); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); setFlipped(false); setAt(a => Math.max(0, a - 1)); }
            else if (e.key === '1') { e.preventDefault(); keyMarkRef.current('learning'); }
            else if (e.key === '2') { e.preventDefault(); keyMarkRef.current('know'); }
            else if (e.key === '0') { e.preventDefault(); keyMarkRef.current(null); }
            else if (e.key === ' ' || e.key === 'Enter') {
                // Not when a button has focus: Space and Enter are already its click.
                if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') return;
                e.preventDefault();
                setFlipped(f => !f);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [total]);

    const navButton = 'p-2.5 rounded-full bg-[#222222] border border-[#383838] hover:bg-[#3f3f3f] text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-[#222222]';

    // How the deck shown is going: green for known, amber for still learning.
    const known = order.filter(i => markOf(entries[i]) === 'know').length;
    const learning = order.filter(i => markOf(entries[i]) === 'learning').length;
    const showName: Record<Show, string> = { all: 'All terms', learning: 'Still learning', know: 'Know it', unsorted: 'Not sorted' };

    return (
        <Modal onClose={onClose} icon={GalleryVerticalEnd} title="Flashcards" subtitle={deckName} size="lg" bodyClassName="p-6 space-y-5" closeOnNavigate>
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">Show:</span>
                        {/* Lets go of focus once picked, so the arrow keys go back to moving through cards. */}
                        <Select value={show} onValueChange={v => pick(v as Show)} blurOnChange aria-label="Which cards to show">
                            {(['all', 'learning', 'know', 'unsorted'] as Show[]).map(s => (
                                <option key={s} value={s}>{showName[s]} ({count(s)})</option>
                            ))}
                        </Select>
                    </label>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">First:</span>
                        <Segmented<Front>
                            options={[{ value: 'term', label: 'Term' }, { value: 'definition', label: 'Definition' }]}
                            value={front}
                            onPick={v => { setFront(v); setFlipped(false); }}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <SecondaryButton size="sm" onClick={shuffle} disabled={total < 2} title="Mix up the order"><Shuffle className="w-3.5 h-3.5" /> Shuffle</SecondaryButton>
                    {/* The deck again, as the filter now has it (cards sorted since picking it come and go). */}
                    <SecondaryButton size="sm" onClick={() => pick(show)} title="Back to the first card, with the filter applied afresh">
                        <RotateCcw className="w-3.5 h-3.5" /> Start over
                    </SecondaryButton>
                </div>
            </div>

            {card ? (
                // The card: click (or Space) to flip.
                <div style={{ perspective: '1400px' }}>
                    {/* A div, not a button: a definition's links sit inside it. Space flips it (the key handler above). */}
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setFlipped(f => !f)}
                        aria-label={flipped ? `Showing the ${back}. Click to flip back.` : `Showing the ${front}. Click to flip.`}
                        className="relative w-full h-80 cursor-pointer select-none focus:outline-none"
                        style={{ transformStyle: 'preserve-3d', transition: animate ? 'transform 450ms cubic-bezier(.2,.7,.2,1)' : undefined, transform: flipped ? 'rotateY(180deg)' : undefined }}
                    >
                        <Face side={front} entry={card} back={false} />
                        <Face side={back} entry={card} back />
                    </div>
                </div>
            ) : (
                <div className="h-80 rounded-2xl border border-[#303030] bg-[#141414] flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <p className="text-sm text-gray-400">No cards are {showName[show].toLowerCase()} right now.</p>
                    <SecondaryButton size="sm" onClick={() => pick('all')}>Show all terms</SecondaryButton>
                </div>
            )}

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                {/* This card's sorting, as one switch like Term | Definition: picking a side sorts it (see keyMark for when
                    that moves on); picking the side it's already on puts it back to not sorted. */}
                <Segmented<Mark>
                    className="justify-self-start"
                    disabled={!card}
                    value={card ? markOf(card) ?? null : null}
                    options={([['learning', X, 'text-amber-400', '1'], ['know', Check, 'text-green-400', '2']] as const).map(([m, icon, color, key]) => ({
                        value: m,
                        label: MARK_LABEL[m],
                        icon,
                        iconClassName: color,
                        title: card && markOf(card) === m ? `${MARK_LABEL[m]} (click again for not sorted)` : `${MARK_LABEL[m]} (${key})`,
                    }))}
                    onPick={m => { if (card) keyMark(markOf(card) === m ? null : m); }}
                />
                <div className="flex items-center gap-4">
                    <button type="button" onClick={() => go(at - 1)} disabled={at === 0 || !card} className={navButton} title="Previous (Left arrow)" aria-label="Previous card">
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-400 tabular-nums min-w-16 text-center">
                        {card ? <CardNumber at={at} total={total} onJump={go} /> : <span className="text-white font-semibold">0</span>} / {total}
                    </span>
                    <button type="button" onClick={() => go(at + 1)} disabled={at >= total - 1 || !card} className={navButton} title="Next (Right arrow)" aria-label="Next card">
                        <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
                <span />
            </div>

            <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-[#272727] overflow-hidden flex">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${total ? (known / total) * 100 : 0}%` }} />
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${total ? (learning / total) * 100 : 0}%` }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
                    <span><span className="text-amber-400">{learning}</span> still learning · <span className="text-green-400">{known}</span> know it · {total - known - learning} not sorted</span>
                    <span>Space flips · 1 still learning · 2 know it · 0 not sorted</span>
                </div>
            </div>
        </Modal>
    );
}
