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

function getSeason(m: number): 'Spring' | 'Summer' | 'Fall' | 'Winter' {
    if (m >= 3 && m <= 5) return 'Spring';
    if (m >= 6 && m <= 8) return 'Summer';
    if (m >= 9 && m <= 11) return 'Fall';
    return 'Winter'; // 12, 1, 2
}

/** The month the U.S. federal fiscal year starts in (October to September). */
const US_FISCAL_YEAR_START_MONTH = 10;

/** "Q1 FY2027": the U.S. fiscal quarter of a month, and the fiscal year (named for the calendar year it ends in). */
function getFiscalUSQuarter(y: number, m: number): string {
    const start = US_FISCAL_YEAR_START_MONTH;
    const quarter = Math.floor(((m - start + 12) % 12) / 3) + 1;
    const fiscalYear = m < start ? y : y + 1;
    return `Q${quarter} FY${fiscalYear}`;
}

/** The day's number in its year: January 1 is 1, December 31 is 365 (366 in a leap year). */
function getDayOfYear(y: number, m: number, d: number): number {
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** The ISO week number (1-53): weeks start on Monday, and week 1 is the one with the year's first Thursday. Around
 *  New Year a day can belong to the neighbouring year's week (January 1 can be week 52 or 53). */
function getWeekOfYear(y: number, m: number, d: number): number {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7)); // that week's Thursday
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** The week of the month (1-6) as a calendar draws it: weeks start on Sunday, and the first (partial) one is week 1. */
function getWeekOfMonth(y: number, m: number, d: number): number {
    return Math.ceil((d + new Date(y, m - 1, 1).getDay()) / 7);
}

// ── Placeholders ─────────────────────────────────────────────────────────────

/** The placeholders a log's text can use, in the order they're listed where they're explained. */
export const PLACEHOLDER_KEYS = [
    'weekday', 'weekdayShort', 'day', 'month', 'monthName', 'monthNameShort', 'year', 'yearShort',
    'dayOfYear', 'weekOfYear', 'weekOfMonth', 'season', 'fiscalUSQuarter', 'fiscalUSYear', 'fiscalUSYearShort', 'observanceUSFederal', 'observanceChristian', 'totalDays', 'daysInMonth',
] as const;
export type PlaceholderKey = typeof PLACEHOLDER_KEYS[number];

/** The ones that are numbers: these can be used in math ({{dayOfYear + 1}}). */
export const NUMERIC_PLACEHOLDER_KEYS = [
    'day', 'month', 'year', 'yearShort', 'dayOfYear', 'weekOfYear', 'weekOfMonth', 'totalDays', 'daysInMonth'
] as const;
type NumericKey = typeof NUMERIC_PLACEHOLDER_KEYS[number];

/** Checks if a year is a leap year (366 days instead of 365). */
function isLeapYear(y: number): boolean {
    return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

/** The numeric placeholders on a day, as numbers ("2026-10-19"). */
function numericValues(iso: string): Record<NumericKey, number> {
    const [y, m, d] = iso.split('-').map(Number);
    return {
        day: d,
        month: m,
        year: y,
        yearShort: y % 100,
        dayOfYear: getDayOfYear(y, m, d),
        weekOfYear: getWeekOfYear(y, m, d),
        weekOfMonth: getWeekOfMonth(y, m, d),
        totalDays: isLeapYear(y) ? 366 : 365,
        daysInMonth: new Date(y, m, 0).getDate(),
    };
}

/** The U.S. federal fiscal year named for the calendar year it ends in (Oct-Sep). */
function getFiscalUSYear(y: number, m: number): number {
    return m < US_FISCAL_YEAR_START_MONTH ? y : y + 1;
}

/** Standard U.S. federal holidays, observed on the nearest weekday when they fall on a weekend. */
function getFederalUSObservance(y: number, m: number, d: number): string {
    const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const observed = (yy: number, mm: number, dd: number) => {
        const date = new Date(yy, mm - 1, dd);
        const dow = date.getDay();
        if (dow === 6) { date.setDate(date.getDate() - 1); } // Sat -> Fri
        else if (dow === 0) { date.setDate(date.getDate() + 1); } // Sun -> Mon
        return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
    };
    const nthWeekday = (yy: number, mm: number, weekday: number, n: number) => {
        const first = new Date(yy, mm - 1, 1);
        let day = 1 + ((weekday - first.getDay() + 7) % 7);
        day += (n - 1) * 7;
        return day;
    };
    const lastWeekday = (yy: number, mm: number, weekday: number) => {
        const last = new Date(yy, mm, 0).getDate();
        let day = last - ((new Date(yy, mm - 1, last).getDay() - weekday + 7) % 7);
        return day;
    };
    const target = iso(y, m, d);
    const checks: [string, string][] = [];
    checks.push(['New Year\'s Day', observed(y, 1, 1)]);
    checks.push(['Martin Luther King Jr. Day', iso(y, 1, nthWeekday(y, 1, 1, 3))]);
    checks.push(['Washington\'s Birthday', iso(y, 2, nthWeekday(y, 2, 1, 3))]);
    checks.push(['Memorial Day', iso(y, 5, lastWeekday(y, 5, 1))]);
    checks.push(['Juneteenth National Independence Day', observed(y, 6, 19)]);
    checks.push(['Independence Day', observed(y, 7, 4)]);
    checks.push(['Labor Day', iso(y, 9, nthWeekday(y, 9, 1, 1))]);
    checks.push(['Columbus Day', iso(y, 10, nthWeekday(y, 10, 1, 2))]);
    checks.push(['Veterans Day', observed(y, 11, 11)]);
    checks.push(['Thanksgiving Day', iso(y, 11, nthWeekday(y, 11, 4, 4))]);
    checks.push(['Christmas Day', observed(y, 12, 25)]);
    for (const [name, date] of checks) if (date === target) return name;
    return '';
}

/** Christian holidays (Western), including movable feasts based on Easter. */
function getChristianObservance(y: number, m: number, d: number): string {
    const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const target = iso(y, m, d);
    // Easter Sunday (Anonymous Gregorian algorithm)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const dd = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - dd - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const mm = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * mm + 114) / 31);
    const day = ((h + l - 7 * mm + 114) % 31) + 1;
    const easter = new Date(y, month - 1, day);
    const addDays = (base: Date, n: number) => { const r = new Date(base); r.setDate(r.getDate() + n); return r; };
    const fmt = (dt: Date) => iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const checks: [string, string][] = [
        ['Epiphany', iso(y, 1, 6)],
        ['Ash Wednesday', fmt(addDays(easter, -46))],
        ['Palm Sunday', fmt(addDays(easter, -7))],
        ['Good Friday', fmt(addDays(easter, -2))],
        ['Easter Sunday', fmt(easter)],
        ['Ascension Day', fmt(addDays(easter, 39))],
        ['Pentecost', fmt(addDays(easter, 49))],
        ['All Saints\' Day', iso(y, 11, 1)],
        ['Christmas Day', iso(y, 12, 25)],
    ];
    for (const [name, date] of checks) if (date === target) return name;
    return '';
}

/** What each placeholder is on a day ("2026-10-19"): the weekday and month names are the system's language. */
export function placeholderValues(iso: string): Record<PlaceholderKey, string> {
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    const name = (o: Intl.DateTimeFormatOptions) => day.toLocaleDateString(undefined, o);
    const n = numericValues(iso);
    return {
        weekday: name({ weekday: 'long' }),
        weekdayShort: name({ weekday: 'short' }),
        day: String(n.day),
        month: String(n.month),
        monthName: name({ month: 'long' }),
        monthNameShort: name({ month: 'short' }),
        year: String(n.year),
        yearShort: String(n.yearShort).padStart(2, '0'),
        dayOfYear: String(n.dayOfYear),
        weekOfYear: String(n.weekOfYear),
        weekOfMonth: String(n.weekOfMonth),
        season: getSeason(m),
        fiscalUSQuarter: getFiscalUSQuarter(y, m),
        fiscalUSYear: `FY${getFiscalUSYear(y, m)}`,
        fiscalUSYearShort: `FY${String(getFiscalUSYear(y, m) % 100).padStart(2, '0')}`,
        observanceUSFederal: getFederalUSObservance(y, m, d),
        observanceChristian: getChristianObservance(y, m, d),
        totalDays: String(n.totalDays),
        daysInMonth: String(n.daysInMonth),
    };
}

// ── Math in placeholders ─────────────────────────────────────────────────────

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
    floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, min: Math.min, max: Math.max,
};

/**
 * Works out a sum like `1 + day % daysInMonth` or `(day / daysInMonth) * 100`, or null when it isn't one (an unknown name, a
 * stray character, a division by zero...). Numbers, the numeric placeholders (by name, any case), + - * / % ^ (power),
 * parentheses, and floor / ceil / round / abs / min / max. `%` is the true modulo (never negative). Read by hand, never
 * `eval`: what's typed here can't run anything.
 */
function evaluateMath(source: string, variables: Record<string, number>): number | null {
    const tokens = source.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/%^(),]|\S/g) ?? [];
    let pos = 0;
    const at = (...ops: string[]) => pos < tokens.length && ops.includes(tokens[pos]);
    const fail = (): never => { throw new Error('not math'); };

    function expression(): number {
        let value = term();
        while (at('+', '-')) {
            const op = tokens[pos++];
            const right = term();
            value = op === '+' ? value + right : value - right;
        }
        return value;
    }
    function term(): number {
        let value = unary();
        while (at('*', '/', '%')) {
            const op = tokens[pos++];
            const right = unary();
            if (op === '*') value *= right;
            else if (right === 0) fail();
            else if (op === '/') value /= right;
            else value = ((value % right) + right) % right;
        }
        return value;
    }
    // A sign binds looser than a power, as in maths: -2^2 is -4.
    function unary(): number {
        if (at('-')) { pos++; return -unary(); }
        if (at('+')) { pos++; return unary(); }
        return power();
    }
    function power(): number {
        const base = atom();
        if (at('^')) { pos++; return base ** unary(); }
        return base;
    }
    function atom(): number {
        if (pos >= tokens.length) return fail();
        const token = tokens[pos++];
        if (/^\d/.test(token)) return parseFloat(token);
        if (token === '(') {
            const value = expression();
            if (!at(')')) fail();
            pos++;
            return value;
        }
        if (/^[A-Za-z_]/.test(token)) {
            const name = token.toLowerCase();
            if (at('(')) {
                pos++;
                const fn = MATH_FUNCTIONS[name];
                if (!fn) return fail();
                const args: number[] = [];
                if (!at(')')) {
                    args.push(expression());
                    while (at(',')) { pos++; args.push(expression()); }
                }
                if (!at(')')) fail();
                pos++;
                if (args.length === 0) fail();
                return fn(...args);
            }
            const value = variables[name];
            return value === undefined ? fail() : value;
        }
        return fail();
    }

    try {
        const result = expression();
        return pos === tokens.length && Number.isFinite(result) ? result : null;
    } catch {
        return null;
    }
}

/** A result as text: whole numbers as they are, anything else to two decimals. */
function formatNumber(n: number): string {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * `text` with its {{placeholders}} filled in for a day. A {{name}} (any case) is that placeholder; anything else
 * inside {{ }} is tried as math over the numeric placeholders ({{1 + day % daysInMonth}}). What is neither (an unknown name,
 * math that doesn't work out) is left as typed.
 */
export function fillPlaceholders(text: string, iso: string): string {
    const [, m, d] = iso.split('-').map(Number) as any;
    text = text.replace(/\{\{@event:([^}]*)\}\}/g, (_w, body: string) => {
        const pairs = body.match(/--(\d{2})-(\d{2})\s*=\s*"([^"]*)"/g) ?? [];
        for (const p of pairs) {
            const mm = p.match(/--(\d{2})-(\d{2})/)!;
            const name = p.match(/=\s*"([^"]*)"/)![1];
            if (Number(mm[1]) === m && Number(mm[2]) === d) return name;
        }
        return '';
    });
    const strings: Record<string, string> = { ...placeholderValues(iso) };
    strings.monthShort = strings.monthNameShort; // older templates
    strings.fiscalQuarter = strings.fiscalUSQuarter; // its first name
    const byName = new Map(Object.entries(strings).map(([k, v]) => [k.toLowerCase(), v]));
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries(numericValues(iso))) numbers[k.toLowerCase()] = v;
    return text.replace(/\{\{([^{}]*)\}\}/g, (whole, inner: string) => {
        const named = byName.get(inner.trim().toLowerCase());
        if (named !== undefined) return named;
        if (!/^[\w\s.+\-*/%^(),]+$/.test(inner)) return whole;
        const result = evaluateMath(inner, numbers);
        return result === null ? whole : formatNumber(result);
    });
}

/** What a day's Entry starts as under a log's template: that weekday's text if it has its own, else the one for any day. */
export function entryTemplateFor(template: { all: string; days: string[] } | undefined | null, iso: string): string {
    if (!template) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const text = (template.days[new Date(y, m - 1, d).getDay()] ?? '').trim() || template.all.trim();
    return text ? fillPlaceholders(text, iso) : '';
}

// ── How a log writes its dates ───────────────────────────────────────────────

/**
 * The ways a log can write a day, in its Date column. 'auto' is the reader's own (their system's order and words:
 * "Sat, Oct 10, 2026" in the US). The others fix the order whatever the system's is; the weekday and month names are
 * still the system's language. 'custom' is a format the reader types from {{placeholders}} and their own text. Each log
 * has its own format, chosen in its Entry Template window and remembered in this browser (as its column widths are).
 * The custom format itself is one, shared by every log that uses 'custom'.
 */
export const LOG_DATE_FORMATS = ['auto', 'custom', 'mdy-weekday', 'dmy-weekday', 'weekday-d-mon-y', 'weekday-mon-d-y', 'ymd-weekday', 'long', 'mdy', 'dmy', 'ymd'] as const;
export type LogDateFormat = typeof LOG_DATE_FORMATS[number];

/** What each is called where it's chosen (the pattern; the chooser shows today written that way beside it). */
export const LOG_DATE_FORMAT_LABEL: Record<LogDateFormat, string> = {
    'auto': 'Automatic',
    'custom': 'Custom',
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

const CUSTOM_FORMAT_KEY = 'kinesis.logs.dateFormat.customPattern';
const DEFAULT_CUSTOM_PATTERN = '{{weekday}}, {{monthName}} {{day}}, {{year}}';

export function loadLogDateFormatCustom(): string {
    try {
        const saved = localStorage.getItem(CUSTOM_FORMAT_KEY);
        // A pattern with no {{placeholder}} is one from before they existed (YYYY-MM-DD): use the default instead.
        return saved && saved.includes('{{') ? saved : DEFAULT_CUSTOM_PATTERN;
    } catch { return DEFAULT_CUSTOM_PATTERN; }
}

export function saveLogDateFormatCustom(pattern: string) {
    try {
        if (!pattern) localStorage.removeItem(CUSTOM_FORMAT_KEY);
        else localStorage.setItem(CUSTOM_FORMAT_KEY, pattern);
    } catch { /* just not remembered */ }
}

/** A day ("2026-10-10") as a log writes it. For 'custom', `customPattern` is the format (the saved one when omitted). */
export function formatLogDate(iso: string, format: LogDateFormat, customPattern?: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (Number.isNaN(day.getTime())) return iso;
    if (format === 'custom') {
        const pat = (customPattern ?? loadLogDateFormatCustom()).trim();
        return pat ? fillPlaceholders(pat, iso) : iso;
    }
    const two = (n: number) => String(n).padStart(2, '0');
    const part = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString(undefined, options);
    const weekdayShort = part({ weekday: 'short' });
    const weekdayLong = part({ weekday: 'long' });
    const monthShort = part({ month: 'short' });
    const monthLong = part({ month: 'long' });
    switch (format) {
        case 'mdy-weekday': return `${two(m)}/${two(d)}/${two(y % 100)} (${weekdayShort})`;
        case 'dmy-weekday': return `${two(d)}/${two(m)}/${two(y % 100)} (${weekdayShort})`;
        case 'weekday-d-mon-y': return `${weekdayShort} ${two(d)} ${monthShort} ${y}`;
        case 'weekday-mon-d-y': return `${weekdayShort}, ${monthShort} ${two(d)}, ${y}`;
        case 'ymd-weekday': return `${iso} (${weekdayShort})`;
        case 'long': return `${weekdayLong}, ${monthLong} ${two(d)}, ${y}`;
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
