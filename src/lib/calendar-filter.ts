import { normalizeText } from './utils';

/**
 * The Calendar's search bar as a filter (components/CalendarView.tsx), read from what the SearchBar hands it. Like the
 * Glossary's and Library's bars, it's one filter at a time:
 *   - plain text, whose words an item's name, description or track's name must all contain;
 *   - or one facet chip and its value: track:"Data Structures", importance:high, status:overdue, kind:video.
 * (Importance is an item's priority, under the name the search bar uses for it.)
 * A facet's value may be cut short (importance:hi, status:o): it fits whatever it's the start of, so the list narrows as
 * it's typed. A chip with nothing typed after it filters nothing yet.
 */

export type CalendarFacet = 'track' | 'importance' | 'status' | 'kind';
type CalendarStatus = 'overdue' | 'progress' | 'done' | 'todo';

export interface CalendarFilter {
    words: string[];
    facet: CalendarFacet | null;
    /** The facet's value, lowercased and trimmed. */
    value: string;
}

/** Each facet's values, in the order the bar suggests them (SearchBar's ghost text). */
export const CALENDAR_FACET_VALUES: Record<Exclude<CalendarFacet, 'track'>, string[]> = {
    importance: ['high', 'medium', 'low', 'none'],
    status: ['overdue', 'in progress', 'to do', 'done'],
    kind: ['video', 'task'],
};
const PRIORITY_LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
const STATUS_OF: Record<string, CalendarStatus> = { overdue: 'overdue', 'in progress': 'progress', 'to do': 'todo', done: 'done' };

/** Reads what the bar hands over: `facet:value`, or plain text. */
export function parseCalendarFilter(text: string): CalendarFilter {
    const facet = text.trim().match(/^(track|importance|status|kind):(.*)$/i);
    if (facet) {
        const value = facet[2].trim().replace(/^"|"$/g, '').trim().toLowerCase();
        return { words: [], facet: facet[1].toLowerCase() as CalendarFacet, value };
    }
    return { words: text.split(/\s+/).map(normalizeText).filter(Boolean), facet: null, value: '' };
}

/** Whether anything is being filtered at all. */
export function isFiltering(f: CalendarFilter): boolean {
    return f.words.length > 0 || (f.facet !== null && f.value !== '');
}

/** The text to mark where it shows: in an item's name, the words; in a track's name, the words or the Track facet's value. */
export function highlightTerms(f: CalendarFilter): { item: string[]; track: string[] } {
    if (f.facet === 'track' && f.value) return { item: [], track: [normalizeText(f.value)] };
    return { item: f.words, track: f.words };
}

/** A text cut into the runs that match one of `terms` (already normalized) and the runs between. */
export function splitMatches(text: string, terms: string[]): { text: string; hit: boolean }[] {
    if (terms.length === 0 || !text) return [{ text, hit: false }];
    // normalizeText keeps each character's place except "…", so it's read a character at a time to stay lined up.
    const lower = text.split('').map(c => (c === '…' ? c : normalizeText(c))).join('');
    const hit = new Array<boolean>(lower.length).fill(false);
    for (const term of terms) {
        for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + 1)) hit.fill(true, at, at + term.length);
    }
    const runs: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
        const last = runs[runs.length - 1];
        if (last && last.hit === hit[i]) last.text += text[i];
        else runs.push({ text: text[i], hit: hit[i] });
    }
    return runs;
}

/** Whether the filter looks at items (not just at which track they're on). */
export function filtersItems(f: CalendarFilter): boolean {
    return f.words.length > 0 || (f.facet !== null && f.facet !== 'track' && f.value !== '');
}

/** The values of a facet that what's typed is the start of ("hi" → high; "to" → to do). */
function valuesFitting(facet: Exclude<CalendarFacet, 'track'>, typed: string): string[] {
    return CALENDAR_FACET_VALUES[facet].filter(v => v.startsWith(typed) || v.replace(' ', '').startsWith(typed));
}

/** Whether a track itself fits the Track facet. */
export function trackFits(f: CalendarFilter, track: { name: string }): boolean {
    return !(f.facet === 'track' && f.value && !normalizeText(track.name).includes(normalizeText(f.value)));
}

/** Whether one item fits the filter. `track.name` counts toward the words, so a track's name finds all its items. */
export function itemFits(
    f: CalendarFilter,
    item: { title: string; description: string; priority: number; done: boolean; inProgress: boolean; overdue: boolean; videoId: string | null },
    track: { name: string },
): boolean {
    if (!trackFits(f, track)) return false;
    if (f.facet && f.facet !== 'track' && f.value) {
        const fitting = valuesFitting(f.facet, f.value);
        if (f.facet === 'importance') return fitting.some(v => PRIORITY_LEVEL[v] === item.priority);
        if (f.facet === 'kind') return fitting.includes(item.videoId ? 'video' : 'task');
        // Overdue isn't a state of its own but a flag on one: an item can be in progress and overdue, and fits both.
        // "To do" is everything not done (overdue and in progress ones included).
        const fits: Record<CalendarStatus, boolean> = {
            done: item.done,
            progress: item.inProgress,
            overdue: item.overdue && !item.done,
            todo: !item.done,
        };
        return fitting.some(v => fits[STATUS_OF[v]]);
    }
    if (f.words.length) {
        const haystack = normalizeText(`${item.title} ${item.description} ${track.name}`);
        if (!f.words.every(w => haystack.includes(w))) return false;
    }
    return true;
}
