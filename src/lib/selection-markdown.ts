import { SEEK_ATTR } from './remark-timestamps';

/**
 * Turns what's selected in a rendered markdown view (the Sidebar's Transcript and Summary, a Glossary definition, a
 * Biography) back into markdown, for the reading views' "Copy as Markdown". Only the selection itself is copied, half a
 * sentence included, so it's rebuilt from the page rather than looked up in the source.
 *
 * It knows the app's own pieces, which plain HTML would lose:
 *   - a link carries its real address in `data-md-href` (its href is just "#", see MarkdownLink.tsx);
 *   - something drawn in place of a link (a video or playlist card) carries the markdown it came from in `data-md-replace`;
 *   - a [1:23] timestamp chip (SEEK_ATTR) goes back to [1:23];
 *   - <mark> goes back to ==highlight==;
 *   - anything marked `data-md-skip` (a timed video link's "▶ 1:00", which its address already holds) is left out.
 *
 * Text is copied as it reads, without escaping: what was written as markdown comes back as the same markdown, and a stray
 * `*` in plain captions stays a `*`.
 */
export function selectionToMarkdown(range: Range, root: HTMLElement): string {
    let body = serializeChildren(range.cloneContents());
    // A selection wholly inside some formatting (a few words of a bold phrase, part of a link) clones as bare text: the
    // formatting is above where the selection starts. Put back each inline wrapper between it and the view's root.
    for (let el = elementOf(range.commonAncestorContainer); el && el !== root && root.contains(el); el = el.parentElement) {
        if (BLOCK.has(el.tagName)) break;
        body = wrapInline(el, body);
    }
    return tidy(body);
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

const elementOf = (node: Node): HTMLElement | null => (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement);

function serializeChildren(node: Node): string {
    let out = '';
    node.childNodes.forEach(child => { out += serialize(child); });
    return out;
}

/** The markdown wrapper an inline element stands for, around `inner` (unchanged for one with no markdown form). */
function wrapInline(el: HTMLElement, inner: string): string {
    if (!inner.trim()) return inner;
    if (el.hasAttribute('data-md-href')) return `[${inner}](${el.getAttribute('data-md-href')})`;
    switch (el.tagName) {
        case 'STRONG': case 'B': return `**${inner}**`;
        case 'EM': case 'I': return `*${inner}*`;
        case 'DEL': case 'S': return `~~${inner}~~`;
        case 'MARK': return `==${inner}==`;
        case 'CODE': return `\`${inner}\``;
        default: return inner;
    }
}

function serialize(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;

    if (el.hasAttribute('data-md-skip')) return '';
    const replace = el.getAttribute('data-md-replace');
    if (replace !== null) return replace;
    if (el.hasAttribute(SEEK_ATTR)) return `[${(el.textContent ?? '').trim()}]`;

    const inner = () => serializeChildren(el);
    // tagName is upper case for HTML, but as written for SVG (`svg`).
    switch (el.tagName.toUpperCase()) {
        case 'SVG': case 'STYLE': case 'SCRIPT': case 'INPUT': return ''; // A task list's checkbox: its item writes [ ] or [x].
        case 'BR': return '\n';
        case 'HR': return '\n\n---\n\n';
        case 'P': return `${inner()}\n\n`;
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
            return `${'#'.repeat(Number(el.tagName[1]))} ${inner().trim()}\n\n`;
        case 'IMG': return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`;
        case 'A': {
            const text = inner();
            const href = el.getAttribute('data-md-href') ?? el.getAttribute('href') ?? '';
            if (!href || href === '#') return text;
            return text.trim() ? `[${text}](${href})` : href;
        }
        case 'PRE': {
            const code = el.querySelector('code');
            const lang = code?.className.match(/language-(\S+)/)?.[1] ?? '';
            return `\n\n\`\`\`${lang}\n${(code ?? el).textContent?.replace(/\n$/, '') ?? ''}\n\`\`\`\n\n`;
        }
        case 'BLOCKQUOTE': {
            const lines = tidy(inner()).split('\n');
            return `\n\n${lines.map(l => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
        }
        // A list nested in an item goes on the very next line (a blank line before it would loosen the outer list).
        case 'UL': case 'OL': return el.parentElement?.tagName === 'LI' ? `\n${serializeList(el)}` : `\n\n${serializeList(el)}\n`;
        // A selection that starts partway down a list clones its items without the list around them.
        case 'LI': return serializeListItem(el, el.parentElement?.tagName === 'OL' ? '1. ' : '- ');
        case 'TABLE': return `\n\n${serializeTable(el)}\n\n`;
        default: return wrapInline(el as HTMLElement, inner());
    }
}

function serializeList(list: Element): string {
    const ordered = list.tagName === 'OL';
    let n = Number(list.getAttribute('start') ?? 1) || 1;
    let out = '';
    for (const child of Array.from(list.children)) {
        if (child.tagName === 'LI') out += serializeListItem(child, ordered ? `${n++}. ` : '- ');
    }
    return out;
}

function serializeListItem(li: Element, marker: string): string {
    const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
    const task = box ? (box.checked ? '[x] ' : '[ ] ') : '';
    const body = tidy(serializeChildren(li));
    // Lines after the first (a nested list, a second paragraph) line up under the item's text. Each level pads only its
    // own items' lines, so a list nested three deep ends up indented three times.
    const [first, ...rest] = body.split('\n');
    const pad = ' '.repeat(marker.length);
    return `${marker}${task}${first}\n${rest.map(l => (l ? pad + l : '')).join('\n')}${rest.length ? '\n' : ''}`;
}

function serializeTable(table: Element): string {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';
    const cells = (tr: Element) => Array.from(tr.children).map(c => tidy(serializeChildren(c)).replace(/\n+/g, ' ').replace(/\|/g, '\\|'));
    const [head, ...body] = rows.map(cells);
    const width = Math.max(...rows.map(r => r.children.length));
    const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    return [line(head), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n');
}

/** No trailing spaces, no more than one blank line in a row, and none at either end. */
function tidy(text: string): string {
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
