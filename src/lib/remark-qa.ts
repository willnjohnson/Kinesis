import type { Blockquote, Paragraph, Parent, PhrasingContent, RootContent } from 'mdast';

/**
 * Remark plugin for a note's questions and answers, written as a callout. The question can sit on the mark's line:
 *
 *      > [!QA] The question
 *      > The answer, as many lines, paragraphs, lists or code blocks as needed.
 *
 * or on the line under it:
 *
 *      > [!QA]
 *      > The question
 *      > The answer
 *
 * A question that needs more than one line puts a rule between the two parts:
 *
 *      > [!QA]
 *      > Question, first line
 *      > second line
 *      >
 *      > ---
 *      > The answer
 *
 * With a rule, the question is the title plus everything before it and the answer is everything after. Without one,
 * the question is the title (or, when the mark stands alone, the first line under it) and the answer is the rest.
 * The blank ">" line above the rule is optional: markdown reads "text" directly over "---" as a heading, and that
 * heading is turned back into a paragraph and a rule here. A callout missing either part is left as the quote it is.
 * The stored text is untouched. Run before the plugins that work on text (highlights, timestamps, embeds) and before
 * any generic callout plugin. lib/markdown-lists.ts's qaFromSelection writes what this reads.
 *
 * How the two parts look is the reading view's (NotesView.tsx draws them by these classes).
 */

const BLOCK = 'k-qa my-4 rounded-lg border border-[#2a2a2a] bg-[#151515] px-4 py-3 flex flex-col gap-2.5';
export const QA_QUESTION_CLASS = 'k-qa-question';
export const QA_ANSWER_CLASS = 'k-qa-answer';

const MARK = /^\s*\[!QA\]\s*/i;

type Line = PhrasingContent[];
type Flow = Blockquote['children'][number];

/** A paragraph's content as the lines it was written on (a soft or a hard line break ends a line). */
function linesOf(children: PhrasingContent[]): Line[] {
    const lines: Line[] = [[]];
    for (const child of children) {
        if (child.type === 'break') {
            lines.push([]);
        } else if (child.type === 'text') {
            child.value.split('\n').forEach((part, i) => {
                if (i > 0) lines.push([]);
                if (part) lines[lines.length - 1].push({ type: 'text', value: part });
            });
        } else {
            lines[lines.length - 1].push(child);
        }
    }
    return lines;
}

const textOf = (node: PhrasingContent): string => ('value' in node ? node.value : 'children' in node ? node.children.map(textOf).join('') : '');
const hasWords = (line: Line) => line.some(n => textOf(n).trim() !== '' || n.type === 'image');

/** Lines back into one paragraph, keeping the line breaks. Null when there's nothing in them. */
function paragraphOf(lines: Line[]): Paragraph | null {
    if (!lines.some(hasWords)) return null;
    return {
        type: 'paragraph',
        children: lines.flatMap((line, i): PhrasingContent[] => (i > 0 ? [{ type: 'break' }, ...line] : line)),
    };
}

/** A div carrying block children (a blockquote node is only the carrier; it's drawn as a div). */
const div = (className: string, children: Flow[]): Blockquote => ({
    type: 'blockquote',
    data: { hName: 'div', hProperties: { className: className.split(' ') } },
    children,
});

/**
 * A setext heading ("text" with "---" directly under it) is a paragraph followed by a rule here: the rule is what
 * splits the question from the answer. Only the first one is undone, and only when no real rule comes before it,
 * so an answer can still hold headings of its own. A setext heading is told from a "##" one by spanning more than
 * one line (its underline is part of it), which needs the tree to still carry positions.
 */
function undoSetext(nodes: Flow[]): Flow[] {
    const isSetext = (n: Flow) => n.type === 'heading' && n.depth === 2 && !!n.position && n.position.start.line !== n.position.end.line;
    const at = nodes.findIndex(n => n.type === 'thematicBreak' || isSetext(n));
    if (at === -1) return nodes;
    const found = nodes[at];
    if (found.type !== 'heading') return nodes;
    return [...nodes.slice(0, at), { type: 'paragraph', children: found.children }, { type: 'thematicBreak' }, ...nodes.slice(at + 1)];
}

/** A "> [!QA]" blockquote as a Q/A block, or null when it isn't one (or lacks a question or an answer). */
function fromCallout(quote: Blockquote): Blockquote | null {
    const [head, ...tail] = undoSetext(quote.children);
    if (head?.type !== 'paragraph') return null;

    const [firstLine, ...restLines] = linesOf(head.children);
    const [lead, ...after] = firstLine;
    if (lead?.type !== 'text' || !MARK.test(lead.value)) return null;

    // The title: what follows the marker on its line.
    const rest = lead.value.replace(MARK, '');
    const title = paragraphOf([rest ? [{ type: 'text', value: rest }, ...after] : after]);

    // The body: the lines under the marker, then the blocks after the first paragraph.
    const more = paragraphOf(restLines);
    const body: Flow[] = [...(more ? [more] : []), ...tail];

    const rule = body.findIndex(node => node.type === 'thematicBreak');
    let question: Flow[];
    let answer: Flow[];
    if (rule === -1) {
        if (title) {
            question = [title];
            answer = body;
        } else {
            // "[!QA]" alone: the first line under it is the question, the rest the answer.
            const [first, ...others] = body;
            if (first?.type !== 'paragraph') return null;
            const [questionLine, ...answerLines] = linesOf(first.children);
            const q = paragraphOf([questionLine]);
            const a = paragraphOf(answerLines);
            question = q ? [q] : [];
            answer = [...(a ? [a] : []), ...others];
        }
    } else {
        question = [...(title ? [title] : []), ...body.slice(0, rule)];
        answer = body.slice(rule + 1);
    }
    if (question.length === 0 || answer.length === 0) return null;

    return div(BLOCK, [div(QA_QUESTION_CLASS, question), div(QA_ANSWER_CLASS, answer)]);
}

export function remarkQa() {
    return (tree: Parent) => {
        tree.children = tree.children.map((node): RootContent => (node.type === 'blockquote' ? (fromCallout(node) ?? node) : node));
    };
}