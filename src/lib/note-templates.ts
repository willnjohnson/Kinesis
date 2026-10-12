import { getSetting, setSetting } from '../api';

/**
 * Note templates: what a new note can start from, instead of a blank page. A few come with the app; the rest are the
 * workspace's own, made from a note with "Save This Note as a Template" and kept in the workspace's settings (one
 * JSON list under `noteTemplates`), so they're there for whoever opens the workspace.
 *
 * A template is a name, and the title and text a note made from it starts with. `{{date}}` in either is the day the
 * note is made ("Oct 10, 2026"). Making a note from a template copies it: changing the template later changes nothing
 * already written.
 */
export interface NoteTemplate {
    name: string;
    /** The new note's title ("" for Untitled). */
    title: string;
    body: string;
}

const KEY = 'noteTemplates';
export const MAX_TEMPLATE_NAME = 60;

/** The ones every workspace has. Plain Markdown a note already understands: headings, task boxes, Q: / A: pairs. */
export const BUILT_IN_TEMPLATES: NoteTemplate[] = [
    {
        name: 'Lecture Notes',
        title: '',
        body: '## Key points\n\n- \n\n## Details\n\n\n\n## Questions\n\nQ: \nA: \n\n## To follow up\n\n- [ ] ',
    },
    {
        name: 'Weekly Review',
        title: 'Week of {{date}}',
        body: '## What I covered\n\n- \n\n## What stuck\n\n\n\n## What didn\'t\n\n\n\n## Next week\n\n- [ ] ',
    },
    {
        name: 'Summary',
        title: '',
        body: '> [!NOTE]\n> One or two sentences: What this is about.\n\n## Main ideas\n\n1. \n2. \n3. \n\n## In my own words\n\n\n\n## Where it came from\n\n',
    },
    {
        name: 'Question Sheet',
        title: '',
        body: 'Q: \nA: \n\nQ: \nA: \n\nQ: \nA: ',
    },
];

/** The workspace's own templates, by name. Empty when there are none, or when what's stored can't be read. */
export async function loadNoteTemplates(): Promise<NoteTemplate[]> {
    try {
        const raw = JSON.parse((await getSetting(KEY)) ?? '[]') as unknown;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((t): t is NoteTemplate => !!t && typeof t.name === 'string' && typeof t.title === 'string' && typeof t.body === 'string' && t.name.trim() !== '')
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

/** Saves a template, in place of one already called that (in any capitals). Returns the list as it now is. */
export async function saveNoteTemplate(template: NoteTemplate): Promise<NoteTemplate[]> {
    const name = template.name.trim().slice(0, MAX_TEMPLATE_NAME);
    const rest = (await loadNoteTemplates()).filter(t => t.name.toLowerCase() !== name.toLowerCase());
    const all = [...rest, { ...template, name }].sort((a, b) => a.name.localeCompare(b.name));
    await setSetting(KEY, JSON.stringify(all));
    return all;
}

export async function deleteNoteTemplate(name: string): Promise<NoteTemplate[]> {
    const all = (await loadNoteTemplates()).filter(t => t.name !== name);
    await setSetting(KEY, JSON.stringify(all));
    return all;
}

/** Whether a note is still just what a template gave it: the same title and text, whatever day was filled in for
 *  `{{date}}`. Such a note has nothing of the reader's in it yet (it's deleted without asking). */
export function isUntouchedTemplate(title: string, body: string, templates: NoteTemplate[]): boolean {
    const same = (made: string, from: string) => {
        const pattern = from.trim().split(/\{\{\s*date\s*\}\}/i).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
        return new RegExp(`^${pattern}$`, 's').test(made.trim());
    };
    return templates.some(t => same(title, t.title) && same(body, t.body));
}

/** A template's text with `{{date}}` filled in: `today` is "2026-10-10", written out as "Oct 10, 2026". */
export function fillTemplate(text: string, today: string): string {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return text.replace(/\{\{\s*date\s*\}\}/gi, date);
}
