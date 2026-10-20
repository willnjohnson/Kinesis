import { createContext, useContext } from 'react';
import { openCalendarNote } from '../../lib/notes';
import { NotebookPen, Video as VideoIcon } from 'lucide-react';
import { getNote, getSummary, getTranscript, type CalendarAdvanceMode, type CalendarEntry, type CalendarRepeat, type CalendarTrack, type CalendarTrackSummary, type WdbsNode } from '../../api';
import { usableText } from '../../lib/utils';
import { splitMatches } from '../../lib/calendar-filter';
import { useTextPreview } from '../GlossaryPreview';
import { inlineMarkdown } from '../../lib/preview-markdown';
import { calendarIcon, priorityOf } from '../../lib/calendar-icons';

/** How each way of advancing is named and explained in the UI. */
export const MODES: { mode: CalendarAdvanceMode; label: string; hint: string }[] = [
    { mode: 'completion', label: 'One after another', hint: "The next one comes up once you've finished the last. No dates." },
    { mode: 'calendar', label: 'On a schedule', hint: 'One per scheduled day, like a class on Mon/Wed/Fri, done or not.' },
    { mode: 'hybrid', label: 'Due in order', hint: "Each one has a day, and waits for the one before it to be done. Falling behind shows as overdue." },
];
export const MODE_LABEL: Record<CalendarAdvanceMode, string> = { completion: 'One after another', calendar: 'On a schedule', hybrid: 'Due in order' };
export const WEEKDAYS = [
    { day: 1, short: 'Mon' }, { day: 2, short: 'Tue' }, { day: 3, short: 'Wed' }, { day: 4, short: 'Thu' },
    { day: 5, short: 'Fri' }, { day: 6, short: 'Sat' }, { day: 7, short: 'Sun' },
];

/** A track's days every week: what a new track has, and what every `completion` track is saved with. */
export const DEFAULT_REPEAT: CalendarRepeat = { kind: 'weekly', every: 1, ordinal: 1 };
/** A monthly pattern's `ordinal`, 1 to 5, in words. */
export const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Last'];

/** A track's pattern in a few words: "Mon/Wed/Fri", "Mon/Wed/Fri, every other week", "Every 3 days", "First Mon of the
 *  month" (Repeat::label in db/calendar.rs says the same in its messages). */
export function repeatLabel(repeat: CalendarRepeat, weekdays: number[]): string {
    const days = WEEKDAYS.filter(w => weekdays.includes(w.day)).map(w => w.short).join('/');
    if (repeat.kind === 'interval') return repeat.every <= 1 ? 'Every day' : repeat.every === 2 ? 'Every other day' : `Every ${repeat.every} days`;
    if (repeat.kind === 'monthly') return `${ORDINALS[Math.min(Math.max(repeat.ordinal, 1), 5) - 1]} ${days} of the month`;
    if (repeat.every === 2) return `${days}, every other week`;
    if (repeat.every > 2) return `${days}, every ${repeat.every} weeks`;
    return weekdays.length === 7 ? 'Every day' : days;
}

// Days as whole numbers (days since 1970, worked out in UTC so a clock change never shifts one), for counting between them.
const dayNumber = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Whether `day` is one of a pattern's days, for a schedule starting on `start`: the same rule as Repeat::lands_on in
 *  db/calendar.rs, which is the one that decides. This one only previews a pattern while it's being set, so it knows
 *  nothing of terms or holidays. */
export function repeatLandsOn(repeat: CalendarRepeat, start: string, weekdays: number[], day: string): boolean {
    const n = dayNumber(day), s = dayNumber(start);
    if (repeat.kind === 'interval') return mod(n - s, Math.max(1, repeat.every)) === 0;
    if (!weekdays.includes(mod(n + 3, 7) + 1)) return false; // day 0 was a Thursday
    if (repeat.kind === 'monthly') {
        const date = new Date(n * 86_400_000);
        // The last one: a week later is in the next month.
        if (repeat.ordinal >= 5) return new Date((n + 7) * 86_400_000).getUTCMonth() !== date.getUTCMonth();
        return Math.floor((date.getUTCDate() - 1) / 7) + 1 === repeat.ordinal;
    }
    const monday = (x: number) => x - mod(x + 3, 7);
    return mod((monday(n) - monday(s)) / 7, Math.max(1, repeat.every)) === 0;
}

/** Each track's color, picked from its id so it stays the same: distinct hues that read on dark and light themes. */
export const TRACK_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16'];
export const trackColor = (id: number) => TRACK_COLORS[id % TRACK_COLORS.length];

export function parseDay(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}
export function isoDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso: string, n: number): string {
    const d = parseDay(iso);
    d.setDate(d.getDate() + n);
    return isoDay(d);
}
/** The first `count` days of a pattern, from `start` on (see repeatLandsOn). */
export function firstDays(repeat: CalendarRepeat, start: string, weekdays: number[], count: number): string[] {
    const days: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return days;
    for (let i = 0; i < 800 && days.length < count; i++) {
        const day = addDays(start, i);
        if (repeatLandsOn(repeat, start, weekdays, day)) days.push(day);
    }
    return days;
}
/** A day's place in the week, 1 (Monday) to 7 (Sunday). */
export function weekdayOf(iso: string): number {
    return ((parseDay(iso).getDay() + 6) % 7) + 1;
}
/** The Monday of the week `iso` is in. */
export function weekStartOf(iso: string): string {
    const d = parseDay(iso);
    return addDays(iso, -((d.getDay() + 6) % 7));
}
/** "Mon, Sep 7". */
export function niceDate(iso: string | null | undefined): string {
    if (!iso) return '';
    return parseDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
// ── Times of day, in minutes after midnight ──

/** A typed time of day, in minutes after midnight, or null if it isn't one. Takes it however it's written: "9", "9:30",
 *  "930", "0930", "9:30am", "9 pm", "21:00". Without am/pm, an hour up to 23 is read on the 24-hour clock. */
export function parseClockText(text: string): number | null {
    const m = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '').match(/^(\d{1,2}):?(\d{2})?(am?|pm?)?$/);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    if (minute > 59) return null;
    if (m[3]) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (m[3].startsWith('p') ? 12 : 0);
    } else if (hour > 23) {
        return null;
    }
    return hour * 60 + minute;
}
/** A typed length of time, in whole minutes, or null if it isn't one: "45" (a bare number is minutes), "45m", "1h",
 *  "1h 30m", "1:30", "1.5h", "2 hours", "90 mins". */
export function parseDurationText(text: string): number | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    const clock = t.match(/^(\d+):(\d{2})$/);
    if (clock) return Number(clock[2]) > 59 ? null : Number(clock[1]) * 60 + Number(clock[2]);
    const units = t.match(/^(?:(\d+(?:\.\d+)?)h(?:ours?|rs?)?)?(?:(\d+)m(?:in(?:ute)?s?)?)?$/);
    if (!units || (!units[1] && !units[2])) return null;
    return Math.round(Number(units[1] ?? 0) * 60) + Number(units[2] ?? 0);
}
/** The shortest window a track's time can be, in minutes (the backend's MIN_DURATION). */
export const MIN_DURATION = 5;
/** "9:00 AM" (or "09:00", as this computer writes times). */
export function clockLabel(minutes: number): string {
    const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
/** "1h 30m", "45m", "2h". */
export function durationLabel(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}
/** A track's time window, "9:00 AM – 10:30 AM", or null for any time that day. */
export function trackTime(track: CalendarTrack): string | null {
    if (track.timeStart == null || track.timeDuration == null) return null;
    return `${clockLabel(track.timeStart)} – ${clockLabel(track.timeStart + track.timeDuration)}`;
}

/** "Sep 7 – 13, 2026", or "Aug 31 – Sep 6, 2026", or across a new year with both years. */
export function weekLabel(start: string): string {
    const a = parseDay(start), b = parseDay(addDays(start, 6));
    const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
    if (a.getFullYear() !== b.getFullYear()) return `${month(a)} ${a.getDate()}, ${a.getFullYear()} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`;
    if (a.getMonth() !== b.getMonth()) return `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`;
    return `${month(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
}

export function flattenDrives(nodes: WdbsNode[], out: WdbsNode[] = []): WdbsNode[] {
    for (const n of nodes) {
        out.push(n);
        flattenDrives(n.children, out);
    }
    return out;
}

/** A track's one-line status in the panel: how far along, or what needs doing. */
export function statusLine({ track, state }: CalendarTrackSummary): { text: string; tone: 'muted' | 'overdue' | 'done' } {
    if (state.total === 0) return { text: 'Empty', tone: 'muted' };
    if (state.finished) return { text: `Finished: All ${state.total} done`, tone: 'done' };
    const current = state.current !== null ? state.entries[state.current] : null;
    if (state.currentOverdue && current) return { text: `Overdue: ${current.title}`, tone: 'overdue' };
    const round = track.loopEntries ? `Round ${state.round + 1} · ` : '';
    if (state.currentWaiting && state.currentDue) return { text: `${round}Next: ${niceDate(state.currentDue)}`, tone: 'muted' };
    return { text: `${round}${state.done} of ${state.total}${current ? ` · ${current.title}` : ''}`, tone: 'muted' };
}

/** An entry's priority, as signal bars in its color (gray low, amber medium, red high), or nothing for none. */
export function PriorityMark({ level, className = 'w-3.5 h-3.5' }: { level: number; className?: string }) {
    const p = priorityOf(level);
    if (!p) return null;
    return (
        <span className="shrink-0 flex" title={`${p.label} priority`}>
            <p.Icon className={`${className} ${p.color}`} aria-label={`${p.label} priority`} />
        </span>
    );
}

/** What the search bar's filter marks, in items' names and in tracks' names (lib/calendar-filter.ts's highlightTerms). */
export const HighlightContext = createContext<{ item: string[]; track: string[] }>({ item: [], track: [] });

/** A name with what the filter is looking for marked in it, in Ctrl+F's yellow (index.css's find-all). */
export function Marked({ text, of }: { text: string; of: 'item' | 'track' }) {
    const terms = useContext(HighlightContext)[of];
    return (
        <>
            {splitMatches(text, terms).map((run, i) => run.hit
                ? <mark key={i} className="bg-yellow-400/35 text-inherit rounded-sm">{run.text}</mark>
                : run.text)}
        </>
    );
}

/** An entry's name, with its icon. Resting the pointer on the name previews it, in the app's usual hover card: a video's
 *  summary (or its transcript, without one), a note's text, a task's description. Nothing to preview, no card. A video
 *  or a note opens from its name. */
export function EntryTitle({ entry, onOpenVideo, className }: { entry: CalendarEntry; onOpenVideo: (videoId: string) => void; className: string }) {
    const preview = useTextPreview(async () => {
        if (entry.videoId) {
            const summary = usableText(await getSummary(entry.videoId).catch(() => null));
            if (summary) return { title: `Summary: ${entry.title}`, markdown: inlineMarkdown(summary.slice(0, 2500)), copyText: summary };
            const transcript = usableText(await getTranscript(entry.videoId).catch(() => null));
            if (transcript) return { title: `Transcript: ${entry.title}`, markdown: inlineMarkdown(transcript.slice(0, 2500)), copyText: transcript };
            return null;
        }
        if (entry.noteId) {
            const body = usableText((await getNote(entry.noteId).catch(() => null))?.body ?? null);
            if (body) return { title: entry.title, markdown: inlineMarkdown(body.slice(0, 2500)), copyText: body };
        }
        return entry.description ? { title: entry.title, markdown: inlineMarkdown(entry.description), copyText: entry.description } : null;
    }, { side: 'right' });

    if (entry.noteId) {
        const noteId = entry.noteId;
        return (
            <>
                <button onClick={() => openCalendarNote(noteId, entry.workbookId)} className={`${className} flex items-center gap-1.5 text-left hover:text-[var(--k-accent)] hover:underline hover:decoration-dotted hover:underline-offset-4 transition-colors cursor-pointer`}>
                    <NotebookPen className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                    <span {...preview.handlers} className="truncate"><Marked text={entry.title} of="item" /></span>
                </button>
                {preview.card}
            </>
        );
    }

    if (!entry.videoId) {
        // A task: its own icon (the default task icon if none was picked).
        const Icon = calendarIcon(entry.icon);
        return (
            <>
                <span className={`${className} flex items-center gap-1.5`}>
                    <Icon className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                    <span {...preview.handlers} className="truncate"><Marked text={entry.title} of="item" /></span>
                </span>
                {preview.card}
            </>
        );
    }
    return (
        <>
            <button onClick={() => onOpenVideo(entry.videoId!)} className={`${className} flex items-center gap-1.5 text-left hover:text-[var(--k-accent)] hover:underline hover:decoration-dotted hover:underline-offset-4 transition-colors cursor-pointer`}>
                <VideoIcon className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                <span {...preview.handlers} className="truncate"><Marked text={entry.title} of="item" /></span>
            </button>
            {preview.card}
        </>
    );
}
