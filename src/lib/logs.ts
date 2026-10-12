/** Fired (on window) when a log is asked for from outside the Logs section (the pin menu). */
export const OPEN_LOG_EVENT = 'kinesis:open-log';
let requested: string | null = null;

/** Asks the Logs section to open a log, on today's row, ready to type in. Kept until it's taken, since the section
 *  may not be on screen yet (the caller switches to it): it takes what's waiting when it mounts, and hears the event
 *  when it's already there. */
export function requestLog(id: string) {
    requested = id;
    window.dispatchEvent(new Event(OPEN_LOG_EVENT));
}

/** The log asked for, once. */
export function takeRequestedLog(): string | null {
    const id = requested;
    requested = null;
    return id;
}

/** The weekdays as a log's entry template has them: seven, Sunday first (a Date's own getDay()). */
export const TEMPLATE_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Whether a log has an entry template at all. */
export function hasEntryTemplate(template: { all: string; days: string[] } | undefined | null): boolean {
    return !!template && (template.all.trim() !== '' || template.days.some(d => d.trim() !== ''));
}

/** What a day's Entry starts as under a log's template: that weekday's text if it has its own, else the one for any
 *  day, with `{{weekday}}` ("Saturday") and `{{date}}` filled in for the day. '' without a template. `iso` is the day,
 *  "2026-10-10". `dateFormat`: how the log writes its dates (below); `{{date}}` is written that way, or as "Oct 10,
 *  2026" under the usual one (whose own form starts with the weekday, which a template has `{{weekday}}` for). */
export function entryTemplateFor(template: { all: string; days: string[] } | undefined | null, iso: string, dateFormat: LogDateFormat = 'auto'): string {
    if (!template) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    const text = (template.days[day.getDay()] ?? '').trim() || template.all.trim();
    if (!text) return '';
    return text
        .replace(/\{\{\s*weekday\s*\}\}/gi, TEMPLATE_WEEKDAYS[day.getDay()])
        .replace(/\{\{\s*date\s*\}\}/gi, dateFormat === 'auto' ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : formatLogDate(iso, dateFormat));
}

// ── How a log writes its dates ───────────────────────────────────────────────

/**
 * The ways a log can write a day, in its Date column and for `{{date}}` in its entry template. 'auto' is the reader's
 * own (their system's order and words: "Sat, Oct 10, 2026" in the US). The others fix the order whatever the system's
 * is; the weekday and month names are still the system's language. Each log has its own, chosen in its Entry Template
 * window and remembered in this browser (as its column widths are).
 */
export const LOG_DATE_FORMATS = ['auto', 'mdy-weekday', 'dmy-weekday', 'weekday-d-mon-y', 'weekday-mon-d-y', 'ymd-weekday', 'long', 'mdy', 'dmy', 'ymd'] as const;
export type LogDateFormat = typeof LOG_DATE_FORMATS[number];

/** What each is called where it's chosen (the pattern; the chooser shows today written that way beside it). */
export const LOG_DATE_FORMAT_LABEL: Record<LogDateFormat, string> = {
    'auto': 'Automatic',
    'mdy-weekday': 'MM/DD/YY (Weekday)',
    'dmy-weekday': 'DD/MM/YY (Weekday)',
    'weekday-d-mon-y': 'Weekday DD Mon YYYY',
    'weekday-mon-d-y': 'Weekday, Mon DD, YYYY',
    'ymd-weekday': 'YYYY-MM-DD (Weekday)',
    'long': 'Weekday, Month DD, YYYY (in full)',
    'mdy': 'MM/DD/YYYY',
    'dmy': 'DD/MM/YYYY',
    'ymd': 'YYYY-MM-DD',
};

/** A day ("2026-10-10") as a log writes it. */
export function formatLogDate(iso: string, format: LogDateFormat): string {
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (Number.isNaN(day.getTime())) return iso;
    const two = (n: number) => String(n).padStart(2, '0');
    const part = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString(undefined, options);
    const weekday = part({ weekday: 'short' });
    const month = part({ month: 'short' });
    switch (format) {
        case 'mdy-weekday': return `${two(m)}/${two(d)}/${two(y % 100)} (${weekday})`;
        case 'dmy-weekday': return `${two(d)}/${two(m)}/${two(y % 100)} (${weekday})`;
        case 'weekday-d-mon-y': return `${weekday} ${two(d)} ${month} ${y}`;
        case 'weekday-mon-d-y': return `${weekday}, ${month} ${d}, ${y}`;
        case 'ymd-weekday': return `${iso} (${weekday})`;
        case 'long': return `${part({ weekday: 'long' })}, ${part({ month: 'long' })} ${d}, ${y}`;
        case 'mdy': return `${two(m)}/${two(d)}/${y}`;
        case 'dmy': return `${two(d)}/${two(m)}/${y}`;
        case 'ymd': return iso;
        default: return part({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
}

const dateFormatKey = (logId: string) => `kinesis.logs.dateFormat.${logId}`;

export function loadLogDateFormat(logId: string | null): LogDateFormat {
    if (!logId) return 'auto';
    try {
        const saved = localStorage.getItem(dateFormatKey(logId));
        return (LOG_DATE_FORMATS as readonly string[]).includes(saved ?? '') ? saved as LogDateFormat : 'auto';
    } catch { return 'auto'; }
}

export function saveLogDateFormat(logId: string, format: LogDateFormat) {
    try {
        if (format === 'auto') localStorage.removeItem(dateFormatKey(logId));
        else localStorage.setItem(dateFormatKey(logId), format);
    } catch { /* just not remembered */ }
}
