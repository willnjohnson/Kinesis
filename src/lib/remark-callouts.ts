import type { Blockquote, Paragraph, Parent, RootContent } from 'mdast';

/**
 * Remark plugin for callouts, written the way GitHub writes them: a quote whose first line is a mark in capitals.
 *
 *     > [!NOTE]
 *     > Something worth knowing, even when skimming.
 *
 * Five kinds: NOTE (blue), TIP (green), IMPORTANT (purple), WARNING (yellow), CAUTION (red). The quote keeps being a
 * blockquote; it's given the classes index.css draws a callout by (`k-callout k-callout-note`), its mark is taken out of
 * the text, and a title line ("Note") is put first. A quote without a mark, or with one this doesn't know, is left as
 * the quote it is. Used by every Markdown view; the editor's right-click menu writes the mark (Quote, then a kind).
 *
 * With `foldable` (the Notes section alone passes it), a callout can also be written the way Obsidian writes one that
 * folds, and with a title of its own:
 *
 *     > [!TIP]- Worked example        a minus: it starts folded, and its title opens it
 *     > [!TIP]+ Worked example        a plus: it starts open, and its title folds it
 *     > [!TIP] Worked example         neither: it doesn't fold; the words are its title, in place of "Tip"
 *
 * The mark is read in either case there (`[!tip]-`, as Obsidian's own notes have it). A callout that folds is given
 * `data-fold` ("closed" or "open"), which the view draws it by (NotesView's Quote). Anywhere else, a mark with a sign
 * or a title after it isn't a mark, and the quote is left as it was written.
 */

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];
export const CALLOUT_TITLE: Record<CalloutKind, string> = { note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION' };

const MARK = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;
// The foldable form: the mark, a sign or none, then spaces. What follows on the line is its title.
const FOLD_MARK = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([+-]?)[ \t]*/i;

function mark(quote: Blockquote, foldable: boolean) {
    const first = quote.children[0];
    if (first?.type !== 'paragraph') return;
    const head = first.children[0];
    if (head?.type !== 'text') return;
    const m = (foldable ? FOLD_MARK : MARK).exec(head.value);
    if (!m) return;
    const kind = m[1].toLowerCase() as CalloutKind;
    const fold = foldable ? m[2] : '';
    head.value = head.value.slice(m[0].length);
    // A title of its own: what's left of the mark's line, with whatever emphasis it has (the nodes up to the line's
    // end). Only the foldable form has one; the plain mark already ran to the end of its line.
    const own: Paragraph['children'] = [];
    if (foldable) {
        while (first.children.length > 0) {
            const node = first.children[0];
            if (node.type === 'break') break;
            if (node.type === 'text') {
                const at = node.value.indexOf('\n');
                if (at !== -1) {
                    if (at > 0) own.push({ type: 'text', value: node.value.slice(0, at) });
                    node.value = node.value.slice(at + 1);
                    break;
                }
            }
            own.push(first.children.shift()!);
        }
    }
    // The mark goes: out of its text, and with it a hard line break that followed it (two spaces after the mark).
    if (first.children[0]?.type === 'text' && !first.children[0].value) first.children.shift();
    if (first.children[0]?.type === 'break') first.children.shift();
    if (first.children.length === 0) quote.children.shift();
    const named = own.some(n => n.type !== 'text' || n.value.trim() !== '');
    const title: Paragraph = {
        type: 'paragraph',
        data: { hName: 'div', hProperties: { className: ['k-callout-title'] } },
        children: named ? own : [{ type: 'text', value: CALLOUT_TITLE[kind] }],
    };
    quote.children.unshift(title);
    quote.data = {
        ...quote.data,
        hProperties: {
            ...(quote.data as { hProperties?: object } | undefined)?.hProperties,
            className: ['k-callout', `k-callout-${kind}`],
            ...(fold ? { dataFold: fold === '-' ? 'closed' : 'open' } : {}),
        },
    };
}

function walk(node: RootContent | Parent, foldable: boolean) {
    if (node.type === 'blockquote') mark(node as Blockquote, foldable);
    if ('children' in node) for (const child of node.children) walk(child as RootContent, foldable);
}

export function remarkCallouts({ foldable = false }: { foldable?: boolean } = {}) {
    return (tree: Parent) => walk(tree, foldable);
}
