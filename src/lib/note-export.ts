import { save } from '@tauri-apps/plugin-dialog';
import { saveImage, type Note, type Workbook } from '../api';
import { foldVideoLinkTimes } from './internal-links';
import { noteDisplayTitle } from './notes';
import { parseClock } from './remark-timestamps';

/**
 * A note saved as a Markdown file, and a workbook saved as a ZIP of its notes, from their right-click menus. The file
 * is asked for with the system's Save window and written by the app (the same command that saves an image: it writes
 * the bytes it's given).
 *
 * What's written is the note as Markdown that reads anywhere: its title as a heading, then its text, with the links
 * that only mean something inside the app made into ones that do outside it (exportMarkdown below).
 */

// ── File names ───────────────────────────────────────────────────────────────

/** The longest a name made here is, in characters, before its number and its ".md": well inside the 255 a file's name
 *  can have (and the 260 a whole Windows path can), with room left for the folder it's saved in. */
const MAX_NAME = 80;
/** Names Windows keeps for itself, whatever comes after a dot. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** `title` as a file's name (no extension): the characters a file name can't have are taken out, runs of spaces made
 *  one, and a long one cut at MAX_NAME (at a word where it can be). Never empty: "Untitled" when nothing is left. */
export function fileNameFor(title: string, max = MAX_NAME): string {
    // eslint-disable-next-line no-control-regex
    let name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if ([...name].length > max) {
        const cut = [...name].slice(0, max).join('');
        const space = cut.lastIndexOf(' ');
        name = (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
    }
    // A name can't end with a dot or a space on Windows.
    name = name.replace(/[. ]+$/, '');
    if (!name) return 'Untitled';
    return RESERVED.test(name) ? `_${name}` : name;
}

// ── A note as Markdown for elsewhere ─────────────────────────────────────────

/**
 * A note's text for outside the app. A link to a video becomes its YouTube address (at its moment, when it has one),
 * so a citation still leads to what it cites. The other in-app links (a glossary term, a person, another note, a
 * Drive, a sequence, flashcards, a workbook) have nowhere to lead outside the app, and are left as their words.
 * Everything else, callouts and questions included, is the Markdown it was written as.
 */
export function exportMarkdown(body: string): string {
    return foldVideoLinkTimes(body).replace(
        /\[([^[\]]*)\]\(kinesis:\/\/(video|glossary|bio|drive|playlist|note|flashcards|workbook)\/([A-Za-z0-9\-._~%:@!$&'*+,;=]+?)(?:\?t=([0-9:]+))?\)/g,
        (_all, text: string, kind: string, key: string, t?: string) => {
            if (kind !== 'video') return text;
            let id = key;
            try { id = decodeURIComponent(key); } catch { /* as written */ }
            const at = t ? parseClock(t) : null;
            return `[${text}](https://www.youtube.com/watch?v=${encodeURIComponent(id)}${at ? `&t=${Math.floor(at)}s` : ''})`;
        },
    );
}

/** The whole file for a note: its title as the first heading (unless its text already starts with one, or it has no
 *  title), then its text. */
export function noteFile(note: Pick<Note, 'title' | 'body'>): string {
    const body = exportMarkdown(note.body).replace(/\s+$/, '');
    const title = note.title.trim();
    const head = title && !/^#\s/.test(body.trimStart()) ? `# ${title}\n\n` : '';
    return `${head}${body}\n`;
}

// ── A ZIP, written here ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP archive of `files` (each a path inside it, with "/" between folders, and its text). The files are stored as
 * they are, not compressed: notes are small text, and a stored ZIP is a few lines to write and opens everywhere. Names
 * are marked as UTF-8, so a title in any language keeps its letters.
 */
export function zipOf(files: { path: string; text: string }[], when = new Date()): Uint8Array {
    const encoder = new TextEncoder();
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const date = (Math.max(when.getFullYear() - 1980, 0) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.path);
        const data = encoder.encode(file.text);
        const crc = crc32(data);
        // A file's own header, then its bytes.
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);           // version needed
        local.setUint16(6, 0x0800, true);       // names are UTF-8
        local.setUint16(8, 0, true);            // stored
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, data);
        // And its line in the list at the end.
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, 0, true);
        entry.setUint16(12, time, true);
        entry.setUint16(14, date, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, data.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
}

/** A workbook's notes as the files of its ZIP: one folder named after the workbook, and in it each note in the
 *  workbook's order, numbered so that order is the order a folder lists them in ("01 - Title.md"; three digits from a
 *  hundred notes up, and so on). A note that's gone isn't written, and the ones after it keep their own numbers. */
export function workbookFiles(book: Pick<Workbook, 'title' | 'noteIds'>, notes: Pick<Note, 'id' | 'title' | 'body'>[]): { path: string; text: string }[] {
    const folder = fileNameFor(book.title);
    const digits = Math.max(2, String(book.noteIds.length).length);
    const files: { path: string; text: string }[] = [];
    book.noteIds.forEach((id, i) => {
        const note = notes.find(n => n.id === id);
        if (!note) return;
        files.push({ path: `${folder}/${String(i + 1).padStart(digits, '0')} - ${fileNameFor(noteDisplayTitle(note))}.md`, text: noteFile(note) });
    });
    return files;
}

// ── Saving ───────────────────────────────────────────────────────────────────

function base64Of(bytes: Uint8Array): string {
    let binary = '';
    // In pieces: a whole file's bytes as arguments at once would be too many.
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/** Asks where to save, and writes `bytes` there. The path it was saved to, or null when the Save window was closed. */
export async function saveBytes(name: string, kind: { name: string; extensions: string[] }, bytes: Uint8Array): Promise<string | null> {
    const path = await save({ defaultPath: name, filters: [kind] });
    if (!path) return null;
    await saveImage(path, base64Of(bytes));
    return path;
}

/** Saves a note as a Markdown file. The path, or null when it wasn't saved (the Save window closed). */
export function exportNote(note: Pick<Note, 'title' | 'body'>): Promise<string | null> {
    return saveBytes(`${fileNameFor(noteDisplayTitle(note))}.md`, { name: 'Markdown', extensions: ['md'] }, new TextEncoder().encode(noteFile(note)));
}

/** Saves a workbook as a ZIP of its notes (workbookFiles). The path, or null when it wasn't saved. */
export function exportWorkbook(book: Pick<Workbook, 'title' | 'noteIds'>, notes: Pick<Note, 'id' | 'title' | 'body'>[]): Promise<string | null> {
    return saveBytes(`${fileNameFor(book.title)}.zip`, { name: 'ZIP archive', extensions: ['zip'] }, zipOf(workbookFiles(book, notes)));
}
