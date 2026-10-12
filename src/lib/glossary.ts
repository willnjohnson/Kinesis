import type { GlossaryTerm } from '../api';

/** A term name with its ASCII capitalization folded. Names ignore case, the way the Glossary table's own
 *  `COLLATE NOCASE` key does (which folds ASCII letters only), so a link or tag that spells a term differently
 *  still finds it. */
export function foldName(name: string): string {
    return name.replace(/[A-Z]/g, c => c.toLowerCase());
}

/** The Quick Tags every workspace has, in the order the Glossary lists them (its "Essential" section). The same names as
 *  src-tauri/src/db/glossary.rs's BUILT_IN_TAGS, which makes sure they exist and refuses to delete or rename them. */
export const BUILT_IN_TAGS = ['Watch Later', 'Favorite', 'Revisit', 'Key Source', 'Follow Up'] as const;

/** Whether an entry is one of the BUILT_IN_TAGS: a Quick Tag (no definition, no Drives) by one of those names, any case. */
export function isBuiltInTag(entry: GlossaryTerm): boolean {
    return entry.definition.trim() === '' && entry.drives.length === 0 && BUILT_IN_TAGS.some(t => foldName(t) === foldName(entry.term.trim()));
}

/** Whether `path` is the Drive `drive` itself or one beneath it (":FRENCH" covers ":FRENCH-CH1"), ignoring case. */
export function driveCovers(drive: string, path: string): boolean {
    const d = drive.toLowerCase();
    const p = path.toLowerCase();
    return p === d || p.startsWith(d + '-');
}

/** In place of a Drive, for Flashcards: every term (a flashcards link's key, and the deck picker's first choice). */
export const ALL_TERMS = '*';

/** The terms Flashcards studies for `drive`: the ones with a definition (a Quick Tag has nothing on its back) filed
 *  under it or a Drive beneath it; all of those for ALL_TERMS. */
export function studyTerms(entries: readonly GlossaryTerm[], drive: string): GlossaryTerm[] {
    const terms = entries.filter(e => e.definition.trim() !== '');
    return drive === ALL_TERMS ? terms : terms.filter(e => e.drives.some(d => driveCovers(drive, d)));
}

/** Every Drive that has terms to study, at it or beneath it, with how many: the decks Flashcards can be switched
 *  between. A term filed under :MWD-CH1 makes a deck of :MWD-CH1 and of :MWD. In path order. */
export function studyDecks(entries: readonly GlossaryTerm[]): { drive: string; count: number }[] {
    const drives = new Set<string>();
    for (const e of studyTerms(entries, ALL_TERMS)) {
        for (const d of e.drives) {
            const parts = d.split('-');
            parts.forEach((_, i) => drives.add(parts.slice(0, i + 1).join('-')));
        }
    }
    return [...drives].sort().map(drive => ({ drive, count: studyTerms(entries, drive).length }));
}

/** How closely a term filed under `filedUnder` fits a place in `drives` (a video's Drives): the depth of the
 *  deepest of its Drives that is one of them or above one, so a chapter's own term beats its subject's. 0 when
 *  none fits. A term filed under :FRENCH fits a video in :FRENCH-CH2 (1); one under :FRENCH-CH2 fits it better (2). */
export function driveFit(filedUnder: readonly string[], drives: readonly string[]): number {
    let best = 0;
    for (const f of filedUnder) {
        if (drives.some(d => driveCovers(f, d))) best = Math.max(best, f.split('-').length);
    }
    return best;
}

/** Which definition of `term` to show when a term has several (one per set of Drives): the one filed
 *  closest to `preferredDrives` (a video's Drives, or the Drive being browsed; a Drive's terms count for
 *  the Drives beneath it), else the uncategorized one, else the first. */
export function resolveEntry(entries: readonly GlossaryTerm[], term: string, preferredDrives: readonly string[] = []): GlossaryTerm | undefined {
    const wanted = foldName(term);
    const rows = entries.filter(e => foldName(e.term) === wanted);
    if (rows.length <= 1) return rows[0];
    let closest: GlossaryTerm | undefined;
    let closestFit = 0;
    for (const r of rows) {
        const fit = driveFit(r.drives, preferredDrives);
        if (fit > closestFit) { closest = r; closestFit = fit; }
    }
    return closest
        ?? rows.find(r => r.drives.length === 0)
        ?? rows[0];
}

/** name -> true when it's a Standard Term (any Drive's row has a definition), false for a Quick Tag
 *  (every row empty). A name is one thing everywhere, whichever Drive's row you look at. */
export function termKinds(entries: readonly GlossaryTerm[]): Map<string, boolean> {
    const kinds = new Map<string, boolean>();
    for (const e of entries) {
        kinds.set(e.term, (kinds.get(e.term) ?? false) || e.definition.trim() !== '');
    }
    return kinds;
}
