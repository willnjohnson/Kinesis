import type { Log, LogEntry } from '../api';
import { entryTemplateFor, formatLogDate, loadLogDateFormat, type LogDateFormat } from './logs';
import { fileNameFor, saveBytes, zipOf } from './note-export';

/**
 * A log saved as a table for a spreadsheet, from its right-click menu (Export as...): CSV, which anything opens, or
 * XLSX, Excel's own. Either way it's the log's days from its first written one to its last, the oldest first and none
 * left out (logRows), in the sheet's three columns: Date, Entry, Description. A description's emphasis is left as the
 * marks it was typed with (**bold**), since a cell is plain text.
 */

type Row = Pick<LogEntry, 'date' | 'title' | 'description'>;
const HEADINGS = ['Date', 'Entry', 'Description'];
const inOrder = (entries: Row[]) => [...entries].sort((a, b) => a.date.localeCompare(b.date));

/** The day after `iso`. */
function nextDay(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + 1));
    return date.toISOString().slice(0, 10);
}

/**
 * The rows a log is exported as: every day from its first written day to its last, as its sheet shows them. A day
 * that was written in is its entry. A day in between that wasn't is there too, so the dates run without gaps: its
 * Entry is what the log's entry template starts that day as (the dimmed text the sheet shows there; '' without a
 * template), and its Description is empty. `dateFormat`: how the log writes `{{date}}` in a template.
 */
export function logRows(entries: Row[], template?: Log['entryTemplate'] | null, dateFormat: LogDateFormat = 'auto'): Row[] {
    const written = inOrder(entries).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    if (written.length === 0) return inOrder(entries);
    const byDay = new Map<string, Row[]>();
    for (const e of written) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    const rows: Row[] = [];
    const last = written[written.length - 1].date;
    for (let day = written[0].date; day <= last; day = nextDay(day)) {
        rows.push(...(byDay.get(day) ?? [{ date: day, title: entryTemplateFor(template, day, dateFormat), description: '' }]));
    }
    return rows;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** A cell as CSV: in quotes when it has a comma, a quote or a line break in it (a quote inside is doubled). */
const csvCell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** The log as CSV: a heading row, then a row a day. The date is written the way the log writes its dates (the format
 *  chosen in its Entry Template window), since a CSV is only text and has no other way to say how a date should look;
 *  under the automatic one it's as stored ("2026-10-10"), which a spreadsheet reads as a date whatever country it's
 *  set for. Lines end the way the format says they do (CRLF), and the file starts with the mark that tells Excel it's
 *  UTF-8, without which it garbles accented letters. */
export function logCsv(entries: Row[], dateFormat: LogDateFormat = 'auto'): string {
    const rows = [HEADINGS, ...inOrder(entries).map(e => [dateFormat === 'auto' ? e.date : formatLogDate(e.date, dateFormat), e.title, e.description])];
    return `﻿${rows.map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

const xml = (text: string) => text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // What XML can't hold at all (control characters other than tab and the line breaks).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** A day ("2026-10-10") as the number a spreadsheet keeps a date as: days since the end of 1899. Null when it isn't one. */
function dateSerial(iso: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const days = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + 25569;
    return Number.isFinite(days) ? days : null;
}

/**
 * Each of a log's date formats (lib/logs.ts) as the number format Excel shows a date by: the cell stays a real date
 * (it sorts, filters and counts as one) and is only drawn this way, as the log draws it. A backslash keeps the
 * character after it as itself: without one, Excel swaps a slash for the reader's own date separator and reads a comma
 * as something else. The weekday and month names are Excel's, in its own language, as the app's are the system's. The
 * automatic format has none of its own: it's Excel's short date (its built-in format 14), whatever that is for the
 * reader.
 */
const EXCEL_DATE_FORMAT: Record<LogDateFormat, string | null> = {
    'auto': null,
    'mdy-weekday': 'mm\\/dd\\/yy \\(ddd\\)',
    'dmy-weekday': 'dd\\/mm\\/yy \\(ddd\\)',
    'weekday-d-mon-y': 'ddd dd mmm yyyy',
    'weekday-mon-d-y': 'ddd\\, mmm d\\, yyyy',
    'ymd-weekday': 'yyyy\\-mm\\-dd \\(ddd\\)',
    'long': 'dddd\\, mmmm d\\, yyyy',
    'mdy': 'mm\\/dd\\/yyyy',
    'dmy': 'dd\\/mm\\/yyyy',
    'ymd': 'yyyy\\-mm\\-dd',
};
/** The id a workbook's own number formats start at (the ones below it are Excel's built-in ones). */
const CUSTOM_FORMAT = 164;

const textCell = (ref: string, text: string, style: number) =>
    `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;

/**
 * The log as the files of an XLSX workbook (which is a ZIP of XML): one sheet named after the log, a bold heading row
 * that stays put as the sheet scrolls, real dates in the first column (so they sort and filter as dates), shown the
 * way the log writes its dates (`dateFormat`, EXCEL_DATE_FORMAT above), and the Entry and Description as text that
 * wraps in its column.
 */
export function logXlsxFiles(logName: string, entries: Row[], dateFormat: LogDateFormat = 'auto'): { path: string; text: string }[] {
    const dateCode = EXCEL_DATE_FORMAT[dateFormat];
    // Cell styles (the order they're in below): 0 plain, 1 a date, 2 a heading, 3 text that wraps.
    const rows = [
        `<row r="1">${HEADINGS.map((h, i) => textCell(`${'ABC'[i]}1`, h, 2)).join('')}</row>`,
        ...inOrder(entries).map((e, i) => {
            const r = i + 2;
            const serial = dateSerial(e.date);
            const date = serial === null ? textCell(`A${r}`, e.date, 0) : `<c r="A${r}" s="1"><v>${serial}</v></c>`;
            return `<row r="${r}">${date}${textCell(`B${r}`, e.title, 3)}${textCell(`C${r}`, e.description, 3)}</row>`;
        }),
    ];
    // A sheet's name: at most 31 characters, and none of \ / ? * [ ] :
    const sheet = xml(logName.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Log');
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const pkg = 'http://schemas.openxmlformats.org/package/2006';
    return [
        {
            path: '[Content_Types].xml',
            text: `${head}<Types xmlns="${pkg}/content-types">`
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                + '<Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                + '</Types>',
        },
        {
            path: '_rels/.rels',
            text: `${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        },
        {
            path: 'xl/workbook.xml',
            text: `${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="${sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        },
        {
            path: 'xl/_rels/workbook.xml.rels',
            text: `${head}<Relationships xmlns="${pkg}/relationships">`
                + `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/>`
                + `<Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/>`
                + '</Relationships>',
        },
        {
            path: 'xl/styles.xml',
            text: `${head}<styleSheet xmlns="${main}">`
                + (dateCode ? `<numFmts count="1"><numFmt numFmtId="${CUSTOM_FORMAT}" formatCode="${xml(dateCode)}"/></numFmts>` : '')
                + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                + '<cellXfs count="4">'
                + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                // The log's own date format; or 14, the short date of whoever opens it.
                + `<xf numFmtId="${dateCode ? CUSTOM_FORMAT : 14}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>`
                + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
                + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
                + '</cellXfs>'
                + '</styleSheet>',
        },
        {
            path: 'xl/worksheets/sheet1.xml',
            text: `${head}<worksheet xmlns="${main}">`
                + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                // The Date column is wide enough for the format's longest ("Wednesday, September 30, 2026").
                + `<cols><col min="1" max="1" width="${dateFormat === 'long' ? 30 : dateCode && /ddd/.test(dateCode) ? 20 : 14}" customWidth="1"/>`
                + '<col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="80" customWidth="1"/></cols>'
                + `<sheetData>${rows.join('')}</sheetData>`
                + '</worksheet>',
        },
    ];
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** Saves a log (`entries`: all of its written days) as CSV or XLSX, where the reader says, with the days in between
 *  filled in (logRows). The path, or null when the Save window was closed. */
export function exportLog(log: Pick<Log, 'id' | 'name' | 'entryTemplate'>, entries: Row[], format: 'csv' | 'xlsx'): Promise<string | null> {
    const name = fileNameFor(log.name);
    const dateFormat = loadLogDateFormat(log.id);
    const rows = logRows(entries, log.entryTemplate, dateFormat);
    return format === 'csv'
        ? saveBytes(`${name}.csv`, { name: 'CSV', extensions: ['csv'] }, new TextEncoder().encode(logCsv(rows, dateFormat)))
        : saveBytes(`${name}.xlsx`, { name: 'Excel workbook', extensions: ['xlsx'] }, zipOf(logXlsxFiles(log.name, rows, dateFormat)));
}
