import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TAB_FIELD_ATTR } from '../lib/tab-fields';
import { Bell, BellRing, CalendarDays, FileDown, LayoutTemplate, NotebookText, Pencil, Plus, Trash2 } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import {
    calendarToday, createLog, LOGS_CHANGED_EVENT, deleteLog, listLogEntries, listLogs, renameLog, setLogEntryTemplate, setLogRemind, writeLogDay,
    type Log, type LogEntry, type LogEntryTemplate,
} from '../api';
import { getThemeCssVariables, resolveContentTheme, type Theme } from '../lib/themes';
import type { DisplaySettings } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { handleMarkdownContextMenu, handlePlainContextMenu } from '../lib/markdown-editor';
import { EMPHASIS_ONLY_ATTR } from './MarkdownContextMenu';
import {
    entryTemplateFor, formatLogDate, hasEntryTemplate, loadLogDateFormat, loadLogDateFormatCustom, LOG_DATE_FORMAT_LABEL, LOG_DATE_FORMATS, OPEN_LOG_EVENT,
    NUMERIC_PLACEHOLDER_KEYS, PLACEHOLDER_KEYS, placeholderValues, saveLogDateFormat, saveLogDateFormatCustom, takeRequestedLog, TEMPLATE_WEEKDAYS,
    type LogDateFormat,
} from '../lib/logs';
import { exportLog } from '../lib/log-export';
import { Modal } from './Modal';
import { SecondaryButton } from './ui/Button';
import { Segmented } from './ui/Segmented';
import { Select } from './ui/Select';
import { normalizeText } from '../lib/utils';
import { BottomBar } from './BottomBar';
import { ConfirmDialog } from './ConfirmDialog';
import { fullDate, HoverDates } from './HoverDates';
import type { NotificationContent } from './Notification';

const OPEN_KEY = 'kinesis.logs.open';
const NO_WORDS: string[] = [];

/** A date as a log shows it: "Sat, Oct 10, 2026". */
function niceDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// The only emphasis a log's description has: **bold**, *italic*, ~~struck~~ and ==highlighted==. Each pair of marks, and
// what it's drawn as. Nothing else is read: a link written here is the characters it was typed as.
const MARKS: { open: string; wrap: (inner: ReactNode, key: number) => ReactNode }[] = [
    { open: '**', wrap: (inner, key) => <strong key={key} className="font-bold text-white">{inner}</strong> },
    { open: '~~', wrap: (inner, key) => <s key={key}>{inner}</s> },
    { open: '==', wrap: (inner, key) => <mark key={key}>{inner}</mark> },
    { open: '*', wrap: (inner, key) => <em key={key}>{inner}</em> },
];

/** A description's text with its emphasis drawn (see MARKS), and its line breaks kept. */
function emphasized(text: string): ReactNode[] {
    const out: ReactNode[] = [];
    let plain = '';
    let i = 0;
    let key = 0;
    while (i < text.length) {
        const mark = MARKS.find(m => text.startsWith(m.open, i));
        // A pair only counts with something between it that doesn't start or end with a space ("2 * 3 * 4" stays as typed).
        const close = mark ? text.indexOf(mark.open, i + mark.open.length) : -1;
        const inner = mark && close > i ? text.slice(i + mark.open.length, close) : '';
        if (mark && inner && !inner.includes('\n') && inner.trim() === inner) {
            if (plain) { out.push(plain); plain = ''; }
            out.push(mark.wrap(emphasized(inner), key++));
            i = close + mark.open.length;
        } else {
            plain += text[i++];
        }
    }
    if (plain) out.push(plain);
    return out;
}

/** Ctrl+B / I / H and Ctrl+Shift+X in a description: the selection wrapped in (or freed of) that mark. The same keys as
 *  the Markdown editors', and the only formatting there is here. */
function emphasisKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const mark = !e.shiftKey ? (k === 'b' ? '**' : k === 'i' ? '*' : k === 'h' ? '==' : null) : k === 'x' ? '~~' : null;
    if (!mark) return;
    e.preventDefault();
    const t = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = t;
    const selected = t.value.substring(start, end);
    const wrapped = selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2;
    const text = wrapped ? selected.slice(mark.length, -mark.length) : `${mark}${selected}${mark}`;
    document.execCommand('insertText', false, text);
    const from = selected ? start : start + mark.length;
    setTimeout(() => t.setSelectionRange(from, selected ? start + text.length : from), 0);
}

const INPUT = 'w-full bg-[#121212] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600';

/** `iso` moved by `n` days. */
function addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d + n);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The sheet's columns: the day, the title, the description. (A row is cleared by emptying its two cells.)
// Their widths come from the sheet (--log-cols, set where the sheet is drawn): the usual ones, or the ones this log's
// columns were dragged to.
const COLUMNS = 'grid grid-cols-[var(--log-cols)]';
const DEFAULT_COLUMNS = '9.5rem minmax(8rem,16rem) minmax(0,1fr)';
/** A log's Date and Entry column widths (px), once they've been dragged; the Description takes the rest. Remembered in
 *  this browser, each log its own. */
interface ColumnWidths { date: number; entry: number }
const columnsKey = (logId: string) => `kinesis.logs.columns.${logId}`;
const MIN_COLUMN = 72;
/** The least the Description keeps, however far the other two are dragged. */
const MIN_DESCRIPTION = 160;
function loadColumns(logId: string | null): ColumnWidths | null {
    if (!logId) return null;
    try {
        const saved = JSON.parse(localStorage.getItem(columnsKey(logId)) ?? 'null');
        return saved && Number.isFinite(saved.date) && Number.isFinite(saved.entry) ? { date: saved.date, entry: saved.entry } : null;
    } catch { return null; }
}
function saveColumns(logId: string, widths: ColumnWidths | null) {
    try {
        if (widths) localStorage.setItem(columnsKey(logId), JSON.stringify(widths));
        else localStorage.removeItem(columnsKey(logId));
    } catch { /* just not remembered */ }
}
// The grip between two columns: on the line between their headings, and as tall as the sheet (which clips it), so a
// column can be dragged from any row.
const COLUMN_GRIP = 'absolute z-10 top-0 -right-[4px] w-[7px] h-[100000px] cursor-col-resize hover:bg-[var(--k-accent)]/30 active:bg-[var(--k-accent)]/50 transition-colors';
const CELL = 'w-full h-full min-h-9 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder-gray-700 focus:bg-[#1c1c1c] focus:shadow-[inset_0_0_0_1px_var(--k-accent)]';

/**
 * One row of the sheet: a day, and what was written for it. The day is the row's own and can't be typed in; the title
 * and description are cells typed straight into. Nothing is "added" or "saved" by hand: leaving the row writes it (a
 * blank row that got words becomes an entry, an entry whose words changed is updated, and one emptied is removed).
 * The description shows its emphasis drawn until it's clicked into, when it shows the marks as typed. A day is one
 * row: more to say about it is another line in its description (Enter).
 */
function SheetRow({ logId, date, dateFormat, customPattern, entry, template, today, showDate, onChanged, onFailed }: {
    logId: string;
    date: string;
    /** How this log writes its dates (lib/logs.ts). */
    dateFormat: LogDateFormat;
    /** The format used when `dateFormat` is 'custom'. */
    customPattern: string;
    entry: LogEntry | null;
    /** What the Entry starts as on a day with nothing written (the log's entry placeholder, for this day); '' for none.
     *  It's shown dimmed, and isn't saved by itself: the day is written when something is typed in the row. */
    template: string;
    today: string;
    /** False for a day's second row and on: the day is said once. */
    showDate: boolean;
    onChanged: () => void;
    onFailed: (what: string, e: unknown) => void;
}) {
    const [title, setTitle] = useState(entry?.title ?? template);
    const [description, setDescription] = useState(entry?.description ?? '');
    const [writing, setWriting] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    const areaRef = useRef<HTMLTextAreaElement>(null);
    // The description's box is as tall as what's in it.
    useEffect(() => {
        const el = areaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [description, writing]);

    const leave = async (e: React.FocusEvent) => {
        // Moving between this row's own cells isn't leaving it.
        if (rowRef.current?.contains(e.relatedTarget as Node | null)) return;
        setWriting(false);
        const t = title.trim(), d = description.trim();
        // Nothing to write: a blank day left blank, or a day left as it was.
        // Nor a blank day whose Entry is only what the placeholder put there.
        if (entry ? t === entry.title && d === entry.description : !d && (!t || t === template.trim())) return;
        try {
            await writeLogDay(logId, date, t, d);
            onChanged();
        } catch (err) { onFailed("Couldn't save that row", err); }
    };

    const isToday = date === today;
    const later = date > today;
    return (
        <div ref={rowRef} {...(isToday ? { 'data-today': '' } : {})} onBlur={e => void leave(e)} className={`group ${COLUMNS} border-b border-[#222] divide-x divide-[#222] ${isToday ? 'bg-[var(--k-accent)]/[0.06]' : ''}`}>
            <div className={`px-3 py-2 text-sm tabular-nums select-none whitespace-nowrap overflow-hidden text-ellipsis ${isToday ? 'text-white font-semibold' : later ? 'text-gray-600' : 'text-gray-400'}`} title={isToday ? 'Today' : undefined}>
                {showDate ? formatLogDate(date, dateFormat, customPattern) : ''}
            </div>
            <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setWriting(true); setTimeout(() => areaRef.current?.focus(), 0); } }}
                onContextMenu={handlePlainContextMenu}
                maxLength={200}
                aria-label={`Entry for ${niceDate(date)}`}
                title={!entry && template && title === template ? "From this log's entry placeholder: not saved until you write in this row" : undefined}
                className={`${CELL} font-semibold ${!entry && template && title === template ? 'text-gray-500!' : ''}`}
            />
            {writing || !description ? (
                <textarea
                    ref={areaRef}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={5000}
                    onFocus={() => setWriting(true)}
                    onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); else emphasisKey(e); }}
                    // Over selected text, the emphasis this cell draws (the menu is told that's all there is here);
                    // anywhere else, Cut / Copy / Paste.
                    {...{ [EMPHASIS_ONLY_ATTR]: '' }}
                    onContextMenu={e => (e.currentTarget.selectionStart !== e.currentTarget.selectionEnd ? handleMarkdownContextMenu(e) : handlePlainContextMenu(e))}
                    rows={1}
                    aria-label={`Description for ${niceDate(date)}`}
                    className={`${CELL} resize-none overflow-hidden leading-relaxed`}
                />
            ) : (
                // Read: the emphasis drawn. A click (or Tab onto it) turns it back into the box it's typed in.
                <div
                    tabIndex={0}
                    {...{ [TAB_FIELD_ATTR]: '' }}
                    onFocus={() => { setWriting(true); setTimeout(() => areaRef.current?.focus(), 0); }}
                    className="px-3 py-2 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words cursor-text min-h-9"
                >
                    {emphasized(description)}
                </div>
            )}
        </div>
    );
}

/** The placeholders and what each is today, for the two places they're explained. */
function PlaceholderList({ today }: { today: string }) {
    const values = placeholderValues(today);
    return (
        <>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                {PLACEHOLDER_KEYS.map(k => (
                    <li key={k} className="truncate"><code className="text-gray-300">{`{{${k}}}`}</code> {values[k]}</li>
                ))}
            </ul>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-2">
                The numbers ({NUMERIC_PLACEHOLDER_KEYS.map((k, i) => <span key={k}>{i > 0 && ', '}<code className="text-gray-300">{k}</code></span>)}) also work
                in math, e.g.: <code className="text-gray-300">{'{{1 + day % totalDays}}'}</code>.<br/>(NOTE: Use + - * / % ^ and ( ), and floor, ceil, round, abs, min, max.)
            </p>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-2">
                Add your own event mapping (string several together for multiple mappings), e.g.:<br/>
                <code className="text-gray-300">{'{{@event: --10-20 = "Birthday"}}'}</code><br/>
                <code className="text-gray-300">{'{{@event: --12-25 = "Christmas"}} {{@event: --12-26 = "Boxing Day"}} {{@event: --01-01 = "New Year"}}'}</code><br/>
                <code className="text-gray-300">{'{{@event: --04-01 = "Renew Business License"}}'}</code>
            </p>
        </>
    );
}

const TEMPLATE_SUB_TABS: { id: 'dates' | 'placeholder'; label: string }[] = [
    { id: 'dates', label: 'Date Format' },
    { id: 'placeholder', label: 'Entry Text' },
];

/**
 * A log's entry template, set. Two tabs: Date Format (how the log writes its dates, in its Date column: one of the
 * usual formats, or Custom, built from {{placeholders}}), and Entry Placeholder (what a day's Entry starts as). Of the
 * placeholder's three modes one is in effect: None; Every Day (one text for any day); By Weekday (a text for each
 * weekday that should have one; a weekday left empty starts empty). What's typed under a mode is kept while the window
 * is open, but only the open mode's is saved. Both tabs share one state, so switching loses nothing and Save writes both.
 */
function EntryTemplateModal({ log, onClose, onSave }: {
    log: Log;
    onClose: () => void;
    onSave: (template: LogEntryTemplate, dateFormat: LogDateFormat, customPattern: string) => void;
}) {
    const had = log.entryTemplate;
    const [subTab, setSubTab] = useState<'dates' | 'placeholder'>('dates');
    const [dateFormat, setDateFormat] = useState<LogDateFormat>(() => loadLogDateFormat(log.id));
    const [textTab, setTextTab] = useState<'none' | 'all' | 'days'>(had.days.some(d => d.trim()) ? 'days' : had.all.trim() ? 'all' : 'none');
    const [customPattern, setCustomPattern] = useState<string>(() => loadLogDateFormatCustom());
    const [all, setAll] = useState(had.all);
    const [days, setDays] = useState<string[]>(() => TEMPLATE_WEEKDAYS.map((_, i) => had.days[i] ?? ''));
    const today = calendarToday();
    const none = TEMPLATE_WEEKDAYS.map(() => '');
    const draft: LogEntryTemplate = textTab === 'all' ? { all, days: none } : textTab === 'days' ? { all: '', days } : { all: '', days: none };
    return (
        <Modal
            onClose={onClose}
            icon={LayoutTemplate}
            title="Entry Template"
            subtitle={log.name}
            size="xl"
            onSubmit={e => { e.preventDefault(); onSave(draft, dateFormat, customPattern); }}
            footer={
                <>
                    <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                    <button type="submit" className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors text-sm font-bold cursor-pointer">Save</button>
                </>
            }
        >
            {/* Sub-tabs, as in Settings > Theme. type="button" so they don't submit the form. */}
            <div className="flex items-center gap-4 pb-1 mb-4">
                {TEMPLATE_SUB_TABS.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSubTab(tab.id)}
                        className={`pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative ${subTab === tab.id ? 'text-white' : 'text-[#666666] hover:text-[#aaaaaa]'}`}
                    >
                        {tab.label}
                        {subTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--k-accent)]" />}
                    </button>
                ))}
            </div>

            {/* The same height whichever tab is open, so the window doesn't jump as they're switched. */}
            <div className="min-h-[20rem]">
                {subTab === 'dates' && (
                    <>
                        <p className="text-xs text-gray-400 leading-relaxed mb-3">
                            How this log writes its dates in its Date column. Each choice shows today written that way.
                        </p>
                        <Select
                            look="setting"
                            value={dateFormat}
                            onValueChange={v => setDateFormat(v as LogDateFormat)}
                            wrapperClassName="w-full"
                            className="w-full"
                        >
                            {LOG_DATE_FORMATS.map(f => (
                                <option key={f} value={f}>{formatLogDate(today, f, customPattern)}{'   ·   '}{LOG_DATE_FORMAT_LABEL[f]}</option>
                            ))}
                        </Select>
                        {dateFormat === 'custom' && (
                            <div className="mt-3">
                                <textarea
                                    autoFocus
                                    value={customPattern}
                                    onChange={e => setCustomPattern(e.target.value)}
                                    onContextMenu={handlePlainContextMenu}
                                    rows={6}
                                    placeholder="{{weekday}}, {{monthName}} {{day}}, {{year}}"
                                    aria-label="Custom date format"
                                    className={INPUT + ' resize-y min-h-[6rem]'}
                                />
                                <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5">
                                    Combine these placeholders with your own text. The format is shared by every log that uses Custom.
                                </p>
                                <PlaceholderList today={today} />
                            </div>
                        )}
                        <p className="text-[11px] text-gray-500 leading-relaxed mt-4">
                            Today is written <span className="text-gray-200 font-semibold">{formatLogDate(today, dateFormat, customPattern)}</span>.
                        </p>
                    </>
                )}

                {subTab === 'placeholder' && (
                    <>
                        <Segmented
                            options={[
                                { value: 'none', label: 'None', title: "No placeholder: A day's Entry starts empty" },
                                { value: 'all', label: 'Every Day', title: 'One text that every day starts with' },
                                { value: 'days', label: 'By Weekday', title: 'A text for each weekday that should have one' },
                            ]}
                            value={textTab}
                            onPick={setTextTab}
                            className="w-fit mb-4"
                        />
                        {textTab === 'none' && (
                            <p className="text-xs text-gray-400 leading-relaxed">
                                No placeholder. Each day's Entry starts empty, and you type it yourself.
                            </p>
                        )}
                        {textTab === 'all' && (
                            <>
                                <p className="text-xs text-gray-400 leading-relaxed mb-3">Every day's Entry starts as this, so it needn't be typed.</p>
                                <input autoFocus value={all} onChange={e => setAll(e.target.value)} onContextMenu={handlePlainContextMenu} maxLength={200} placeholder='e.g. "Training" or "{{weekday}} session"' className={INPUT} />
                            </>
                        )}
                        {textTab === 'days' && (
                            <>
                                <p className="text-xs text-gray-400 leading-relaxed mb-3">Each weekday's Entry starts as its own text. A weekday left empty starts empty.</p>
                                <div className="space-y-1.5">
                                    {TEMPLATE_WEEKDAYS.map((name, i) => (
                                        <div key={name} className="flex items-center gap-3">
                                            <span className="w-24 shrink-0 text-xs text-gray-400">{name}</span>
                                            <input
                                                autoFocus={i === 0}
                                                value={days[i]}
                                                onChange={e => setDays(d => d.map((x, j) => (j === i ? e.target.value : x)))}
                                                onContextMenu={handlePlainContextMenu}
                                                maxLength={200}
                                                placeholder="Nothing"
                                                className={INPUT}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        {textTab !== 'none' && (
                            <>
                                <p className="text-[11px] text-gray-500 leading-relaxed mt-4">
                                    Placeholders work in the text.
                                    {hasEntryTemplate(draft) && <> Today would start as <span className="text-gray-200 font-semibold">{entryTemplateFor(draft, today) || 'nothing'}</span>.</>}
                                </p>
                                <PlaceholderList today={today} />
                                <p className="text-[11px] text-gray-500 leading-relaxed mt-3">
                                    It shows dimmed in a day with nothing written, and is saved with the day once you write its description. With a placeholder, the bell's reminder is answered by a day's description, since its Entry is already there.
                                </p>
                            </>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

/**
 * The Logs section: plain records of what was done, day by day. A log is a name of the reader's choosing; the list on
 * the left shows each with how many entries it has and when the last one was, the ones in use first and the empty ones
 * dimmed, so nobody has to open a log to find out whether there's anything in it. The open log is a sheet: a row a
 * day, the oldest first, with the days already there (thirty before today and thirty after, and more either way on
 * request) and a title and a description to type into. There's nothing to add: writing in a day's row is the entry.
 * Today brings today's row back into view. The header's search bar filters the sheet to the rows whose description
 * has what's typed, or with a facet, whose entry (`entry_search:`, !e) or date (`date_search:`, !r) does; and
 * `title_search:` (!n) narrows the list of logs by title instead. A log is renamed by typing over its name. Logs are the
 * reader's own (never exported or synced).
 *
 * A row's middle column is its Entry on screen and `title` in the data (a "title" here would be taken for the log's).
 *
 * `searchQuery`: the bar's text, with a facet's name and a colon before it when one is on.
 */
export function LogsView({ searchQuery, onNotify, displaySettings, customThemes }: { searchQuery: string; onNotify: (n: NotificationContent) => void; displaySettings?: DisplaySettings | null; customThemes?: Theme[] }) {
    const contentTheme = useMemo(
        () => resolveContentTheme(displaySettings, customThemes ?? []),
        [displaySettings, customThemes],
    );
    const contentThemeStyle = useMemo(
        () => displaySettings?.contentThemeLogsEnabled
            ? ({
                ...getThemeCssVariables(contentTheme, displaySettings.blockquoteAccentEnabled ? displaySettings.blockquoteAccentColor : null),
                colorScheme: contentTheme.scheme,
                backgroundColor: 'var(--k-bg)',
                color: 'var(--k-text-white)',
            } as React.CSSProperties)
            : undefined,
        [displaySettings, contentTheme],
    );
    // The section's own name is the workspace's (Logs, unless it's been called something else: Tracker, say).
    const { labels } = useWorkspace();
    const [logs, setLogs] = useState<Log[] | null>(null);
    const [openId, setOpenId] = useState<string | null>(() => { try { return localStorage.getItem(OPEN_KEY); } catch { return null; } });
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [naming, setNaming] = useState<{ id: string | null; text: string } | null>(null);
    const [logToDelete, setLogToDelete] = useState<Log | null>(null);
    // How far the sheet goes either side of today (in days), grown thirty at a time.
    const [back, setBack] = useState(30);
    const [ahead, setAhead] = useState(30);
    const sheetRef = useRef<HTMLDivElement>(null);
    const toToday = useCallback(() => {
        sheetRef.current?.querySelector('[data-today]')?.scrollIntoView({ block: 'center' });
    }, []);
    // The pane the sheet scrolls in: Go to Top and Bottom take it to the sheet's first and last rows.
    const paneRef = useRef<HTMLDivElement>(null);
    const toEnd = (bottom: boolean) => paneRef.current?.scrollTo({ top: bottom ? paneRef.current.scrollHeight : 0 });
    const nameRef = useRef<HTMLInputElement>(null);
    // The open log's column widths: dragged by the grips between the headings, and kept for that log. Null: the usual.
    const [columns, setColumns] = useState<ColumnWidths | null>(() => loadColumns(openId));
    // And how it writes its dates (chosen in its Entry Template window), with the custom format for 'custom'.
    const [dateFormat, setDateFormat] = useState<LogDateFormat>(() => loadLogDateFormat(openId));
    const [customPattern, setCustomPattern] = useState<string>(() => loadLogDateFormatCustom());
    useEffect(() => { setColumns(loadColumns(openId)); setDateFormat(loadLogDateFormat(openId)); }, [openId]);
    const dateHeadRef = useRef<HTMLSpanElement>(null);
    const entryHeadRef = useRef<HTMLSpanElement>(null);
    const dragColumn = (e: React.PointerEvent, which: keyof ColumnWidths) => {
        const sheet = sheetRef.current, dateHead = dateHeadRef.current, entryHead = entryHeadRef.current;
        if (!sheet || !dateHead || !entryHead || !openId) return;
        e.preventDefault();
        const logId = openId;
        const startX = e.clientX;
        // From what's on screen: the usual widths aren't fixed numbers until they're measured.
        const start: ColumnWidths = { date: dateHead.getBoundingClientRect().width, entry: entryHead.getBoundingClientRect().width };
        const room = sheet.clientWidth - MIN_DESCRIPTION;
        let last = start;
        const onMove = (m: PointerEvent) => {
            const other = which === 'date' ? start.entry : start.date;
            const width = Math.round(Math.min(Math.max(start[which] + m.clientX - startX, MIN_COLUMN), Math.max(MIN_COLUMN, room - other)));
            last = { ...start, [which]: width };
            setColumns(last);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.style.cursor = '';
            if (last !== start) saveColumns(logId, last);
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    const resetColumns = () => {
        if (!openId) return;
        setColumns(null);
        saveColumns(openId, null);
    };

    const failed = useCallback((what: string, e: unknown) => onNotify({ message: `${what}: ${typeof e === 'string' ? e.replace(/^Invalid parameter: /, '') : (e as Error)?.message ?? e}`, type: 'error' }), [onNotify]);
    const loadLogs = useCallback(() => listLogs().then(setLogs).catch(e => { setLogs([]); failed("Couldn't load the logs", e); }), [failed]);
    useEffect(() => { void loadLogs(); }, [loadLogs]);

    const open = logs?.find(l => l.id === openId) ?? null;
    // With none chosen (or the chosen one gone), the first listed: the one written in last.
    useEffect(() => {
        if (logs && logs.length > 0 && !open) setOpenId(logs[0].id);
    }, [logs, open]);
    useEffect(() => {
        try { if (openId) localStorage.setItem(OPEN_KEY, openId); } catch { /* just not remembered */ }
        setBack(30);
        setAhead(30);
        if (!openId) { setEntries([]); return; }
        let live = true;
        // A log opens on today's row (it's in the middle of the sheet, not at either end).
        listLogEntries(openId).then(list => { if (live) { setEntries(list); setTimeout(() => { toToday(); typeToday(); }, 0); } }).catch(() => { if (live) setEntries([]); });
        return () => { live = false; };
    }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
    // A log asked for from the pin menu (a reminder, or Log Entry): opened on today's row with the cursor in its Entry.
    const typeTodayRef = useRef(false);
    const typeToday = () => {
        if (!typeTodayRef.current) return;
        typeTodayRef.current = false;
        sheetRef.current?.querySelector<HTMLInputElement>('[data-today] input')?.focus();
    };
    useEffect(() => {
        const take = () => {
            const id = takeRequestedLog();
            if (!id) return;
            typeTodayRef.current = true;
            setOpenId(prev => {
                // Already the open one: its sheet is there, so go to today now (opening it is what would otherwise).
                if (prev === id) setTimeout(() => { toToday(); typeToday(); }, 0);
                return id;
            });
        };
        take();
        window.addEventListener(OPEN_LOG_EVENT, take);
        return () => window.removeEventListener(OPEN_LOG_EVENT, take);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const ring = (log: Log) => {
        setLogRemind(log.id, !log.remind)
            .then(() => { onNotify({ message: log.remind ? `No more reminders for "${log.name}"` : `You'll be reminded in the pin menu on a day "${log.name}" has no entry`, type: 'success' }); return loadLogs(); })
            .catch(e => failed("Couldn't change the reminder", e));
    };
    const reloadEntries = async () => {
        if (openId) setEntries(await listLogEntries(openId));
        await loadLogs();
    };
    // A day written from elsewhere (the pin menu's Log Entry) shows here too.
    const reloadRef = useRef(reloadEntries);
    reloadRef.current = reloadEntries;
    useEffect(() => {
        const onChanged = () => { void reloadRef.current().catch(() => {}); };
        window.addEventListener(LOGS_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(LOGS_CHANGED_EVENT, onChanged);
    }, []);
    useEffect(() => { if (naming) setTimeout(() => nameRef.current?.select(), 0); }, [naming?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const saveName = async () => {
        if (!naming) return;
        const text = naming.text.trim();
        if (!text) { setNaming(null); return; }
        try {
            if (naming.id) await renameLog(naming.id, text);
            else setOpenId((await createLog(text)).id);
            setNaming(null);
            await loadLogs();
        } catch (e) { failed("Couldn't save that name", e); }
    };

    const removeLog = (gone: Log) => {
        setLogToDelete(null);
        deleteLog(gone.id)
            .then(() => { if (openId === gone.id) setOpenId(null); onNotify({ message: `Deleted the log "${gone.name}"`, type: 'success' }); return loadLogs(); })
            .catch(e => failed("Couldn't delete the log", e));
    };
    // The list's right-click menu, for the log it was opened on. Deleting asks first, unless nothing's written in it.
    const [logMenu, setLogMenu] = useState<{ x: number; y: number; log: Log } | null>(null);
    // The log whose entry template is being set, while its window is open.
    const [templateFor, setTemplateFor] = useState<Log | null>(null);
    const closeLogMenu = useCallback(() => setLogMenu(null), []);
    // Read from the database as it's asked for, so it's every entry of that log (not only the days on screen, and not
    // only the open log's).
    const exportAs = (log: Log, format: 'csv' | 'xlsx') => {
        listLogEntries(log.id)
            .then(all => exportLog(log, all, format))
            .then(path => { if (path) onNotify({ message: `Saved "${log.name}" to ${path}`, type: 'success' }); })
            .catch(e => failed("Couldn't export the log", e));
    };
    const logMenuItems = (log: Log): ContextMenuItem[] => [
        { label: 'Open', icon: NotebookText, onClick: () => setOpenId(log.id) },
        { label: 'Rename', icon: Pencil, onClick: () => setNaming({ id: log.id, text: log.name }) },
        { label: 'Remind Me Daily', icon: Bell, checked: log.remind, onClick: () => ring(log) },
        { label: 'Entry Template...', icon: LayoutTemplate, checked: hasEntryTemplate(log.entryTemplate), onClick: () => setTemplateFor(log) },
        // Its days as a table for a spreadsheet (lib/log-export.ts). Nothing to export from one with nothing written.
        {
            label: 'Export as...', icon: FileDown, divider: true, disabled: log.entries === 0, onClick: () => {},
            submenu: log.entries === 0 ? undefined : [
                { label: 'CSV', onClick: () => exportAs(log, 'csv') },
                { label: 'XLSX (Excel)', onClick: () => exportAs(log, 'xlsx') },
            ],
        },
        { label: 'Delete Log', icon: Trash2, danger: true, divider: true, onClick: () => (log.entries === 0 ? removeLog(log) : setLogToDelete(log)) },
    ];

    // The filter: every word typed has to be in the row's description; or, with a facet, in its entry, or in its date
    // (as written, 2026-10-10, or as shown, Sat, Oct 10, 2026). Oldest first, like the sheet. The title facet isn't about
    // rows at all: it narrows the list of logs, by name, and leaves the sheet as it is.
    const where = searchQuery.includes('title_search:') ? 'log' : searchQuery.includes('entry_search:') ? 'title' : searchQuery.includes('date_search:') ? 'date' : 'description';
    const typed = useMemo(
        () => normalizeText(searchQuery.replace(/title_search:|entry_search:|date_search:/g, '').replace(/"/g, '')).split(/\s+/).filter(Boolean),
        [searchQuery],
    );
    const words = where === 'log' ? NO_WORDS : typed;
    const listedLogs = useMemo(
        () => (where === 'log' && typed.length > 0 ? (logs ?? []).filter(l => typed.every(w => normalizeText(l.name).includes(w))) : logs ?? []),
        [logs, where, typed],
    );
    const shown = useMemo(() => {
        const oldestFirst = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
        if (words.length === 0) return oldestFirst;
        return oldestFirst.filter(e => {
            const text = normalizeText(where === 'title' ? e.title : where === 'date' ? `${e.date} ${niceDate(e.date)} ${formatLogDate(e.date, dateFormat, customPattern)}` : e.description);
            return words.every(w => text.includes(w));
        });
    }, [entries, words, where, dateFormat, customPattern]);

    const today = calendarToday();
    // The sheet's rows, the oldest day first: a row a day, blank until it's written in. (A day that has more than one
    // entry, from before a day was one row, shows them all.)
    const rows = useMemo(() => {
        type Row = { key: string; date: string; entry: LogEntry | null; first: boolean };
        const out: Row[] = [];
        if (words.length > 0) {
            shown.forEach((e, i) => out.push({ key: `e${e.id}:${e.updatedAt}`, date: e.date, entry: e, first: i === 0 || shown[i - 1].date !== e.date }));
            return out;
        }
        const byDate = new Map<string, LogEntry[]>();
        for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
        const [earliest, latest] = [addDays(today, -back), addDays(today, ahead)];
        for (let day = earliest; day <= latest; day = addDays(day, 1)) {
            const made = [...(byDate.get(day) ?? [])].sort((a, b) => a.id - b.id);
            made.forEach((e, i) => out.push({ key: `e${e.id}:${e.updatedAt}`, date: day, entry: e, first: i === 0 }));
            if (made.length === 0) out.push({ key: `b${day}`, date: day, entry: null, first: true });
        }
        return out;
    }, [entries, shown, words, back, ahead, today]);
    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400 flex gap-6 h-full">
            <div className="w-72 min-w-52 shrink h-full flex flex-col">
                <h2 className="shrink-0 flex items-center min-h-9 text-xl font-bold text-white mb-4 px-1">{labels.aliasLogs}</h2>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {logs === null ? null : logs.length === 0 && !naming ? (
                        <div className="text-center text-gray-500 min-h-full py-16 bg-[#121212] rounded-xl border border-[#272727] px-4">
                            <p className="text-sm">No logs yet. A log is a running record of what you did: training, reading, a project.</p>
                        </div>
                    ) : (
                        <div className="min-h-full bg-[#121212] rounded-xl border border-[#272727] p-2 space-y-0.5">
                            {listedLogs.length === 0 && !naming && <p className="px-3 py-2 text-xs text-gray-500">No logs match.</p>}
                            {listedLogs.map(l => naming?.id === l.id ? null : (
                                // Resting the pointer on it says when its last entry was and when it was made (a log has
                                // no "last edited" of its own: its entries are what's written).
                                <HoverDates
                                    key={l.id}
                                    title={l.name}
                                    rows={[
                                        { label: 'Last entry', value: l.entries === 0 ? 'Nothing written yet' : niceDate(l.lastDate ?? '') },
                                        { label: 'Entries', value: String(l.entries) },
                                        { label: 'Created', value: fullDate(l.createdAt) },
                                    ]}
                                >{hover => (
                                <div
                                    {...hover}
                                    onClick={() => setOpenId(l.id)}
                                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setLogMenu({ x: e.clientX, y: e.clientY, log: l }); }}
                                    className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${l.id === openId ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-[#272727]'} ${l.entries === 0 && l.id !== openId ? 'opacity-50' : ''}`}
                                >
                                    {/* A dot for a log with entries, a ring for an empty one. */}
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${l.entries > 0 ? (l.id === openId ? 'bg-white' : 'bg-[var(--k-accent)]') : 'border border-current'}`} />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                                            <span className="truncate">{l.name}</span>
                                            {l.remind && <Bell className="w-3 h-3 shrink-0 opacity-70" aria-label="Reminds you daily" />}
                                        </span>
                                        <span className={`block text-[11px] truncate ${l.id === openId ? 'text-white/80' : 'text-gray-500'}`}>
                                            {l.entries === 0 ? 'Empty' : `${l.entries} ${l.entries === 1 ? 'entry' : 'entries'} · last ${l.lastDate === today ? 'today' : niceDate(l.lastDate ?? '')}`}
                                        </span>
                                    </span>
                                </div>
                                )}</HoverDates>
                            ))}
                            {naming && (
                                <input
                                    ref={nameRef}
                                    autoFocus
                                    value={naming.text}
                                    onChange={e => setNaming({ ...naming, text: e.target.value })}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } else if (e.key === 'Escape') setNaming(null); }}
                                    onBlur={() => void saveName()}
                                    onContextMenu={handlePlainContextMenu}
                                    maxLength={80}
                                    placeholder="Name the log"
                                    className={INPUT}
                                />
                            )}
                        </div>
                    )}
                </div>
                <div className="shrink-0 mb-2 mt-3">
                    <button
                        onClick={() => setNaming({ id: null, text: '' })}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-bold transition-all cursor-pointer bg-[#121212] border-[#404040] text-gray-400 hover:text-white hover:border-[#505050]"
                    >
                        <Plus className="w-3.5 h-3.5" /> New Log
                    </button>
                </div>
            </div>

            <div ref={paneRef} className={`flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden custom-scrollbar pb-10 ${contentThemeStyle ? 'k-content-theme' : ''}`} style={contentThemeStyle}>
                {!open ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 px-6">
                        <NotebookText className="w-10 h-10 mb-3 text-gray-600" />
                        <p className="text-lg font-bold text-white mb-1">Keep a record of what you did</p>
                        <p className="text-sm max-w-md leading-relaxed">Start a log and its days are laid out like a sheet, ready to type into: a title and a description for each day.</p>
                    </div>
                ) : (
                    <div className="px-2">
                        {/* Stays at the top while the sheet scrolls under it: the name, Today and delete are always in reach. */}
                        <div className="sticky top-0 z-20 bg-[#0f0f0f] flex items-center gap-2 pt-1 pb-3 border-b border-[#272727]">
                            {/* The log's name, typed over to rename it (as a note's title is): saved on Enter or on leaving
                                it, and put back as it was on Esc or when left empty. */}
                            <input
                                key={`${open.id}:${open.name}`}
                                defaultValue={open.name}
                                maxLength={80}
                                aria-label="The log's name"
                                title="Click to rename this log"
                                onContextMenu={handlePlainContextMenu}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                    else if (e.key === 'Escape') { e.currentTarget.value = open.name; e.currentTarget.blur(); }
                                }}
                                onBlur={e => {
                                    const box = e.currentTarget;
                                    const text = box.value.trim();
                                    if (!text || text === open.name) { box.value = open.name; return; }
                                    renameLog(open.id, text).then(loadLogs).catch(err => { box.value = open.name; failed("Couldn't rename the log", err); });
                                }}
                                className="flex-1 min-w-0 bg-transparent outline-none text-3xl font-bold text-white placeholder-gray-600"
                            />
                            <button onClick={toToday} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="Bring today's row into view">
                                <CalendarDays className="w-3.5 h-3.5" /> Today
                            </button>
                            <span className="shrink-0 flex items-center gap-0.5 text-[11px] font-semibold text-gray-500">
                                <span className="pr-1 select-none">Go to:</span>
                                <button onClick={() => toEnd(false)} className="px-2 py-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="The first row showing (the earliest day)">Top</button>
                                <button onClick={() => toEnd(true)} className="px-2 py-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer" title="The last row showing (the latest day)">Bottom</button>
                            </span>
                            <button
                                onClick={() => setTemplateFor(open)}
                                className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer"
                                title="Entry template: The date format, and what each day's Entry starts as (the same every day or by weekday)"
                            >
                                <LayoutTemplate className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => ring(open)}
                                aria-pressed={open.remind}
                                className={`p-1.5 rounded-md hover:bg-[#272727] transition-colors cursor-pointer ${open.remind ? 'text-[var(--k-accent)]' : 'text-gray-500 hover:text-white'}`}
                                title={open.remind ? 'Reminding you: On a day this log has no entry, the pin menu (in the title bar) says so. Click to stop' : 'Remind me: On a day this log has no entry, the pin menu (in the title bar) will say so'}
                            >
                                {open.remind ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                            </button>
                            <button onClick={() => setLogToDelete(open)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-[#272727] transition-colors cursor-pointer" title="Delete this log">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* The sheet. Unfiltered: every day from a week ahead back to the earliest row (or a month ago), a row
                            each, blank where nothing's written. Filtered: only the rows that match. */}
                        {words.length === 0 && (
                            <button type="button" onClick={() => setBack(b => b + 30)} className="mt-3 text-[11px] font-semibold text-gray-500 hover:text-white transition-colors cursor-pointer">
                                Show 30 earlier days
                            </button>
                        )}
                        <div
                            ref={sheetRef}
                            // In a window too narrow for the widths asked for, the Entry gives way before the Description does.
                            style={{ '--log-cols': columns ? `${columns.date}px minmax(${MIN_COLUMN}px, ${columns.entry}px) minmax(${MIN_DESCRIPTION}px, 1fr)` : DEFAULT_COLUMNS } as React.CSSProperties}
                            // Clipped, not `overflow-hidden`: the grips reach far below the sheet, and a hidden-overflow box
                            // can still be scrolled (going to today's row did, taking the headings out of sight).
                            className="mt-3 rounded-lg border border-[#2a2a2a] overflow-clip"
                        >
                            <div className={`${COLUMNS} divide-x divide-[#2a2a2a] bg-[#161616] border-b border-[#2a2a2a] text-[10px] font-bold uppercase tracking-widest text-gray-500`}>
                                <span ref={dateHeadRef} className="relative px-3 py-2">
                                    Date
                                    {/* No tooltip: it would be placed against the grip's whole (clipped) height. Drag to change
                                        the width; double-click for the usual widths. */}
                                    <span onPointerDown={e => dragColumn(e, 'date')} onDoubleClick={resetColumns} role="separator" aria-orientation="vertical" aria-label="Width of the Date column" className={COLUMN_GRIP} />
                                </span>
                                <span ref={entryHeadRef} className="relative px-3 py-2">
                                    Entry
                                    <span onPointerDown={e => dragColumn(e, 'entry')} onDoubleClick={resetColumns} role="separator" aria-orientation="vertical" aria-label="Width of the Entry column" className={COLUMN_GRIP} />
                                </span>
                                <span className="px-3 py-2">Description</span>
                            </div>
                            {rows.length === 0 ? (
                                <p className="py-8 text-center text-sm text-gray-500">No rows match.</p>
                            ) : rows.map(r => (
                                <SheetRow
                                    // A blank day is drawn again when the placeholder changes what it starts as.
                                    key={r.entry ? r.key : `${r.key}:${entryTemplateFor(open.entryTemplate, r.date)}`}
                                    logId={open.id}
                                    date={r.date}
                                    dateFormat={dateFormat}
                                    customPattern={customPattern}
                                    entry={r.entry}
                                    template={r.entry ? '' : entryTemplateFor(open.entryTemplate, r.date)}
                                    today={today}
                                    showDate={r.first}
                                    onChanged={() => {}}
                                    onFailed={failed}
                                />
                            ))}
                        </div>
                        {words.length === 0 && (
                            <button type="button" onClick={() => setAhead(a => a + 30)} className="mt-3 text-[11px] font-semibold text-gray-500 hover:text-white transition-colors cursor-pointer">
                                Show 30 later days
                            </button>
                        )}
                    </div>
                )}
            </div>

            <BottomBar>
                <div className="flex items-center gap-6 flex-1 min-w-0 text-[11px] font-semibold text-gray-400">
                    <div className="flex items-center gap-6 min-w-0 w-72 shrink-0">
                        <span className="shrink-0 whitespace-nowrap">
                            <span className="text-white">{logs?.length ?? 0}</span> log{(logs?.length ?? 0) === 1 ? '' : 's'}
                            {' ('}<span className="text-white">{(logs ?? []).filter(l => l.entries > 0).length}</span> in use{')'}
                        </span>
                        {open && (
                            <span className="ml-auto min-w-0 truncate">
                                <span className="text-white">{shown.length}</span>{shown.length !== entries.length ? ` of ${entries.length}` : ''} {entries.length === 1 ? 'entry' : 'entries'}
                            </span>
                        )}
                    </div>
                </div>
            </BottomBar>

            {templateFor && (
                <EntryTemplateModal
                    log={templateFor}
                    onClose={() => setTemplateFor(null)}
                    onSave={(template, format, pattern) => {
                        const log = templateFor;
                        setTemplateFor(null);
                        saveLogDateFormatCustom(pattern);
                        setCustomPattern(pattern);
                        saveLogDateFormat(log.id, format);
                        if (log.id === openId) setDateFormat(format);
                        // Only the date format changed: the template is left as it is, and nothing is said of it.
                        const was = log.entryTemplate;
                        if (template.all === was.all && template.days.every((d, i) => d === (was.days[i] ?? ''))) return;
                        setLogEntryTemplate(log.id, template)
                            .then(() => onNotify({ message: hasEntryTemplate(template) ? `Entry placeholder set for "${log.name}"` : `Entry placeholder cleared for "${log.name}"`, type: 'success' }))
                            .catch(e => failed("Couldn't save the entry placeholder", e));
                    }}
                />
            )}
            {logMenu && <ContextMenu x={logMenu.x} y={logMenu.y} items={logMenuItems(logMenu.log)} onClose={closeLogMenu} />}
            {logToDelete && (
                <ConfirmDialog
                    message={`Delete the log "${logToDelete.name}"${logToDelete.entries > 0 ? ` and its ${logToDelete.entries} ${logToDelete.entries === 1 ? 'entry' : 'entries'}` : ''}? This can't be undone.`}
                    onConfirm={() => removeLog(logToDelete)}
                    onCancel={() => setLogToDelete(null)}
                />
            )}
        </div>
    );
}