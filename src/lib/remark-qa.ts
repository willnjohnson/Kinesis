import type { Paragraph, Parent, PhrasingContent, RootContent } from 'mdast';

/**
 * Remark plugin for a note's questions and answers: a "Q:" line with an "A:" line under it shows as a block of its own,
 * the question over the answer. It's a way of writing a note down (a question to come back to, with what was found),
 * drawn; nothing is made from it. Flashcards are the Glossary's.
 *
 * The rule: the mark starts a line of the note itself (not a quote's or a list's) and can be bold (**Q:**), the "A:"
 * line comes straight after the "Q:" line, and the answer runs on until a blank line or the next "Q:". A question with
 * no answer is left as the text it is.
 *
 * Markdown makes lines that follow each other one paragraph, so a paragraph is cut into its lines here: each pair
 * becomes a block (a div holding two more, the question and the answer, named by the classes below) and the lines
 * around it stay paragraphs. The stored text is untouched. Run it before the plugins that work on text (highlights,
 * timestamps, embeds), which then see a block's words like any others. lib/markdown-lists.ts's qaFromSelection writes
 * the lines this reads.
 *
 * How the two parts look is the reading view's (NotesView.tsx draws them by these classes: the answer is covered until
 * it's asked for, which takes a component). Here it's only the block around them.
 */

const BLOCK = 'k-qa my-4 rounded-lg border border-[#2a2a2a] bg-[#151515] px-4 py-3 flex flex-col gap-2.5';
/** The classes a block's question and its answer carry. */
export const QA_QUESTION_CLASS = 'k-qa-question';
export const QA_ANSWER_CLASS = 'k-qa-answer';

type Line = PhrasingContent[];

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

/** The line without its "Q:" (or "A:") mark, or null when it doesn't start with one. The mark may be bold. */
function unmarked(line: Line, letter: 'Q' | 'A'): Line | null {
    const [first, ...rest] = line;
    if (!first) return null;
    if (first.type === 'text') {
        const mark = new RegExp(`^\\s*${letter}:\\s*`, 'i');
        if (!mark.test(first.value)) return null;
        const value = first.value.replace(mark, '');
        return value ? [{ type: 'text', value }, ...rest] : rest;
    }
    if (first.type === 'strong' && new RegExp(`^${letter}:$`, 'i').test(textOf(first).trim())) {
        const [next, ...after] = rest;
        if (next?.type !== 'text') return rest;
        const value = next.value.replace(/^\s+/, '');
        return value ? [{ type: 'text', value }, ...after] : after;
    }
    return null;
}

// Divs drawn through emphasis nodes, so no custom node type is needed (as remark-highlight does for <mark>).
const element = (hName: string, className: string, children: PhrasingContent[]): PhrasingContent => ({
    type: 'emphasis',
    data: { hName, hProperties: { className: className.split(' ') } },
    children,
});

function block(question: Line, answer: Line[]): Paragraph {
    const answerWords = answer.filter(hasWords).flatMap((line, i): PhrasingContent[] => (i > 0 ? [{ type: 'break' }, ...line] : line));
    return {
        type: 'paragraph',
        data: { hName: 'div', hProperties: { className: BLOCK.split(' ') } },
        children: [element('div', QA_QUESTION_CLASS, question), element('div', QA_ANSWER_CLASS, answerWords)],
    };
}

/** The paragraph as it is when it holds no pair; otherwise its pairs as blocks, with the lines between as paragraphs. */
function split(paragraph: Paragraph): RootContent[] {
    const lines = linesOf(paragraph.children);
    const out: RootContent[] = [];
    let plain: Line[] = [];
    let pairs = 0;
    const flush = () => {
        if (plain.some(hasWords)) {
            out.push({ type: 'paragraph', children: plain.flatMap((line, i): PhrasingContent[] => (i > 0 ? [{ type: 'text', value: '\n' }, ...line] : line)) });
        }
        plain = [];
    };
    for (let i = 0; i < lines.length; i++) {
        const question = unmarked(lines[i], 'Q');
        const first = question && hasWords(question) ? unmarked(lines[i + 1] ?? [], 'A') : null;
        if (!question || !first) {
            plain.push(lines[i]);
            continue;
        }
        const answer = [first];
        let j = i + 2;
        while (j < lines.length && !unmarked(lines[j], 'Q')) answer.push(lines[j++]);
        if (!answer.some(hasWords)) {
            plain.push(lines[i]);
            continue;
        }
        flush();
        out.push(block(question, answer));
        pairs++;
        i = j - 1;
    }
    if (pairs === 0) return [paragraph];
    flush();
    return out;
}

export function remarkQa() {
    return (tree: Parent) => {
        tree.children = tree.children.flatMap(node => (node.type === 'paragraph' ? split(node) : [node]));
    };
}
