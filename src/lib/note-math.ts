import type { Parent, Root, RootContent } from 'mdast';
import type { Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

/**
 * Maths in a note, written as LaTeX the way Obsidian and Notesnook take it, and drawn by KaTeX:
 *
 *     The roots are $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ for any quadratic.        in a line of text
 *
 *     $$
 *     \int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}                                   on lines of its own, centered
 *     $$
 *
 * Only the Notes section reads it (NOTE_MATH_REMARK and NOTE_MATH_REHYPE go on its Markdown view): anywhere else a
 * dollar sign is a dollar sign. A formula KaTeX can't read is shown as it was typed, in red, with the reason on hover,
 * and the rest of the note is drawn as usual.
 */

/**
 * Keeps prices from being read as maths: "it costs $5 and $10 more" has two dollar signs, and nothing between them is
 * a formula. The rule is the one Obsidian and Pandoc go by: a formula in a line starts right after its opening dollar
 * and ends right before its closing one (no space inside either), and the closing dollar isn't followed by a digit.
 * What fails it is put back as the text it was typed as. Only a single-dollar pair is judged: `$$x$$` is always maths.
 */
export function remarkMathNotMoney() {
    const visit = (parent: Parent, source = '') => {
        const children = parent.children as RootContent[];
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (node.type === 'inlineMath') {
                // Judged by what was typed, dollars and all (the node's own value has its outer spaces trimmed).
                const start = node.position?.start.offset, end = node.position?.end.offset;
                const typed = start !== undefined && end !== undefined ? source.slice(start, end) : '';
                const single = /^\$[^$]/.test(typed) && /[^$]\$$/.test(typed);
                const inner = typed.slice(1, -1);
                const next = children[i + 1];
                const digitAfter = next?.type === 'text' && /^\d/.test(next.value);
                if (single && (/^\s|\s$/.test(inner) || digitAfter)) {
                    children[i] = { type: 'text', value: typed };
                }
            } else if ('children' in node) {
                visit(node as Parent, source);
            }
        }
        // Text put back sits beside the text around it as separate pieces: joined, so what reads text after this
        // (highlights, timestamps) sees whole runs of it.
        for (let i = children.length - 1; i > 0; i--) {
            const a = children[i - 1], b = children[i];
            if (a.type === 'text' && b.type === 'text') {
                a.value += b.value;
                children.splice(i, 1);
            }
        }
    };
    // Without the text (nothing to judge by), every formula is left as maths.
    return (tree: Root, file?: { value?: unknown }) => visit(tree, typeof file?.value === 'string' ? file.value : '');
}

/** For a note's `remarkPlugins`, ahead of the rest. */
export const NOTE_MATH_REMARK: NonNullable<Options['remarkPlugins']> = [remarkMath, remarkMathNotMoney];
/** For a note's `rehypePlugins`, ahead of the code highlighter (which would otherwise take a formula for a block of
 *  code in a language called "math"). */
export const NOTE_MATH_REHYPE: NonNullable<Options['rehypePlugins']> = [[rehypeKatex, { throwOnError: false, strict: false }]];
