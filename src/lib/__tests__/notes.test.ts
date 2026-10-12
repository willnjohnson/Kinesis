import { describe, expect, it } from 'vitest';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { remarkMathNotMoney } from '../note-math';
import { unified } from 'unified';
import { ALL_TERMS, driveCovers, studyDecks, studyTerms } from '../glossary';
import { foldVideoLinkTimes } from '../internal-links';
import { qaFromSelection } from '../markdown-lists';
import { entryTemplateFor, hasEntryTemplate } from '../logs';
import { BUILT_IN_TEMPLATES, fillTemplate, isUntouchedTemplate } from '../note-templates';
import { logCsv, logRows, logXlsxFiles } from '../log-export';
import { fileNameFor, noteFile, workbookFiles, zipOf } from '../note-export';
import { buildMomentNote, citationCount, noteSources } from '../notes';
import { remarkCallouts } from '../remark-callouts';
import { QA_ANSWER_CLASS, QA_QUESTION_CLASS, remarkQa } from '../remark-qa';

// Reads a tree's text back, a hard line break as a newline.
type Node = { type: string; value?: string; children?: Node[]; data?: { hProperties?: { className?: string[] } } };
const textOf = (n: Node): string => (n.value !== undefined ? n.value : n.type === 'break' ? '\n' : (n.children ?? []).map(textOf).join(''));
const has = (n: Node, cls: string) => n.data?.hProperties?.className?.includes(cls) ?? false;
const parse = (body: string) => unified().use(remarkParse).parse(body) as unknown as Node;

describe('exporting notes', () => {
    it('makes a title a file name', () => {
        expect(fileNameFor('  What is 2/3 of "x"?  ')).toBe('What is 2 3 of x');
        expect(fileNameFor('...')).toBe('Untitled');
        expect(fileNameFor('CON')).toBe('_CON');
        expect([...fileNameFor('word '.repeat(60))].length).toBeLessThanOrEqual(80);
        expect(fileNameFor('x'.repeat(300))).toBe('x'.repeat(80));
    });

    it('writes a note for outside the app', () => {
        expect(noteFile({ title: 'Kinases', body: 'See [Talk](kinesis://video/abc?t=1:30) and [mTOR](kinesis://glossary/mtor).\n\n' }))
            .toBe('# Kinases\n\nSee [Talk](https://www.youtube.com/watch?v=abc&t=90s) and mTOR.\n');
        expect(noteFile({ title: 'Kinases', body: '# My own heading\nText' })).toBe('# My own heading\nText\n');
        expect(noteFile({ title: '', body: '[Talk](kinesis://video/abc)' })).toBe('[Talk](https://www.youtube.com/watch?v=abc)\n');
    });

    it("numbers a workbook's notes in its order", () => {
        const notes = [{ id: 'a', title: 'First', body: 'x' }, { id: 'b', title: '', body: 'Second one\nmore' }];
        expect(workbookFiles({ title: 'Course: Part 1', noteIds: ['b', 'gone', 'a'] }, notes).map(f => f.path))
            .toEqual(['Course Part 1/01 - Second one.md', 'Course Part 1/03 - First.md']);
        const many = Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, title: `N${i}`, body: '' }));
        expect(workbookFiles({ title: 'Big', noteIds: many.map(n => n.id) }, many)[0].path).toBe('Big/001 - N0.md');
    });

    it('writes a ZIP that lists its files', () => {
        const zip = zipOf([{ path: 'Book/01 - A.md', text: 'hello' }, { path: 'Book/02 - Ünï.md', text: 'wörld' }]);
        const view = new DataView(zip.buffer);
        expect(view.getUint32(0, true)).toBe(0x04034b50);
        // The end record: two files, and a list that starts where the files' own parts stop.
        const end = zip.length - 22;
        expect(view.getUint32(end, true)).toBe(0x06054b50);
        expect(view.getUint16(end + 10, true)).toBe(2);
        expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
        // CRC-32 of "hello".
        expect(view.getUint32(14, true)).toBe(0x3610a686);
    });
});

describe("a note's maths", () => {
    type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: string[] | string }; children?: Hast[] };
    const html = (n: Hast): string => {
        if (n.type === 'text') return n.value ?? '';
        const inner = (n.children ?? []).map(html).join('');
        if (n.type !== 'element') return inner;
        const cls = n.properties?.className ? ` class="${([] as string[]).concat(n.properties.className).join(' ')}"` : '';
        return `<${n.tagName}${cls}>${inner}</${n.tagName}>`;
    };
    const draw = async (md: string) => {
        const p = unified().use(remarkParse).use(remarkMath).use(remarkMathNotMoney).use(remarkRehype).use(rehypeKatex, { throwOnError: false, strict: false }).use(rehypeHighlight, { detect: false });
        // With the text itself alongside, as a Markdown view gives it (the price check reads what was typed).
        return html(await p.run(p.parse(md), md) as unknown as Hast);
    };

    it('draws a formula in a line, and one on lines of its own', async () => {
        expect(await draw(String.raw`Roots are $x = \frac{-b}{2a}$ here.`)).toContain('class="katex"');
        const block = await draw(String.raw`$$` + '\n' + String.raw`\int_0^1 x\,dx` + '\n$$');
        expect(block).toContain('katex-display');
        expect(block).not.toContain('<pre');
    });

    it('leaves prices as they were typed', async () => {
        const money = await draw('It costs $5 and $10 more, or $ 3 $ spaced.');
        expect(money).not.toContain('katex');
        expect(money).toContain('It costs $5 and $10 more, or $ 3 $ spaced.');
    });

    it('shows a formula it cannot read as typed, and still colors code', async () => {
        const mixed = await draw(String.raw`$\frac{1$ and` + '\n\n```python\nprint(1)\n```');
        expect(mixed).toContain('katex-error');
        expect(mixed).toContain('hljs-built_in');
    });
});

describe('exporting a log', () => {
    const entries = [
        { date: '2026-09-11', title: 'Rest', description: '' },
        { date: '2026-09-10', title: 'Long run, "easy"', description: 'Two\nlines' },
    ];

    it('writes CSV, the oldest day first', () => {
        expect(logCsv(entries)).toBe('﻿Date,Entry,Description\r\n2026-09-10,"Long run, ""easy""","Two\nlines"\r\n2026-09-11,Rest,\r\n');
    });

    it('fills in the days between the first and the last, with what the template starts them as', () => {
        const written = [{ date: '2026-09-13', title: 'Long run', description: 'x' }, { date: '2026-09-10', title: 'Legs', description: '' }];
        expect(logRows(written).map(r => [r.date, r.title])).toEqual([['2026-09-10', 'Legs'], ['2026-09-11', ''], ['2026-09-12', ''], ['2026-09-13', 'Long run']]);
        // Sunday first: Friday the 11th has its own text, Saturday the 12th the one for any day.
        const template = { all: '{{weekday}} session', days: ['', '', '', '', '', 'Rest', ''] };
        expect(logRows(written, template).map(r => r.title)).toEqual(['Legs', 'Rest', 'Saturday session', 'Long run']);
        // Over a month's end, and nothing added to a log with a single day.
        expect(logRows([{ date: '2026-02-27', title: 'a', description: '' }, { date: '2026-03-02', title: 'b', description: '' }]).map(r => r.date))
            .toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
        expect(logRows([written[0]])).toHaveLength(1);
    });

    it('writes a sheet with real dates', () => {
        const files = logXlsxFiles('Exercise: 2026', [{ date: '2026-09-10', title: 'A & B', description: '<x>' }]);
        expect(files.map(f => f.path)).toContain('xl/worksheets/sheet1.xml');
        const sheet = files.find(f => f.path === 'xl/worksheets/sheet1.xml')!.text;
        // 2026-09-10 as a spreadsheet's day number.
        expect(sheet).toContain('<c r="A2" s="1"><v>46275</v></c>');
        expect(sheet).toContain('A &amp; B');
        expect(sheet).toContain('&lt;x&gt;');
        expect(files.find(f => f.path === 'xl/workbook.xml')!.text).toContain('name="Exercise 2026"');
        // The system's short date, unless the log writes its dates its own way.
        expect(files.find(f => f.path === 'xl/styles.xml')!.text).toContain('numFmtId="14"');
    });

    it("draws the dates the log's way", () => {
        const day = [{ date: '2026-09-10', title: 'A', description: '' }];
        const styles = logXlsxFiles('Log', day, 'mdy-weekday').find(f => f.path === 'xl/styles.xml')!.text;
        expect(styles).toContain('<numFmt numFmtId="164" formatCode="mm\\/dd\\/yy \\(ddd\\)"/>');
        expect(styles).toContain('<xf numFmtId="164"');
        // Still a real date underneath.
        expect(logXlsxFiles('Log', day, 'mdy-weekday').find(f => f.path === 'xl/worksheets/sheet1.xml')!.text).toContain('<c r="A2" s="1"><v>46275</v></c>');
        // A CSV has only text to say it with.
        expect(logCsv(day, 'ymd').split('\r\n')[1]).toBe('2026-09-10,A,');
        expect(logCsv(day, 'mdy').split('\r\n')[1]).toBe('09/10/2026,A,');
    });
});

describe('a cited moment', () => {
    it('quotes the thought, its paragraphs kept apart, with the moment as its source', () => {
        expect(buildMomentNote('Talk', 'abc', 90, 'Hello\n\n\nWorld\n\nWhat\'s up?\n')).toBe(
            "> Hello\n>\n> World\n>\n> What's up?\n>\n> — on [Talk](kinesis://video/abc?t=1:30)",
        );
        expect(citationCount(buildMomentNote('Talk', 'abc', 90, 'Hello'))).toBe(1);
    });
    it('is the link alone with nothing written', () => {
        expect(buildMomentNote('Talk', 'abc', 90, '  ')).toBe('[Talk](kinesis://video/abc?t=1:30)');
    });
});

describe("a note's sources", () => {
    it('reads a moment however it is written', () => {
        const body = [
            '[Talk](kinesis://video/abc?t=87)',
            '> quote\n>\n> — [Other](kinesis://video/xyz)[1:30]',
            'Again [Talk](kinesis://video/abc?t=1:27) and [mTOR](kinesis://glossary/mTOR), [a note](kinesis://note/n1).',
        ].join('\n\n');
        const sources = noteSources(body);
        // 87 seconds and 1:27 are one moment; the [1:30] after a link is that link's time.
        expect(sources.videos).toEqual([{ id: 'abc', title: 'Talk', times: [87] }, { id: 'xyz', title: 'Other', times: [90] }]);
        expect(sources.terms).toEqual(['mTOR']);
        expect(sources.notes).toEqual([{ id: 'n1', title: 'a note' }]);
        expect(citationCount(body)).toBe(1);
    });

    it('folds a timestamp after a video link into the link', () => {
        expect(foldVideoLinkTimes('[T](kinesis://video/abc)[1:30] and [1:45]')).toBe('[T](kinesis://video/abc?t=1:30) and [1:45]');
        expect(foldVideoLinkTimes('[T](kinesis://video/abc?t=5)[1:30]')).toBe('[T](kinesis://video/abc?t=5)[1:30]');
    });

    it('lists a video without a timestamp as a source with no moments', () => {
        const body = [
            '[The Whole Talk](kinesis://video/abc)',
            '> — [Summary](kinesis://video/xyz)',
        ].join('\n\n');
        const sources = noteSources(body);
        expect(sources.videos).toEqual([
            { id: 'abc', title: 'The Whole Talk', times: [] },
            { id: 'xyz', title: 'Summary', times: [] },
        ]);
        expect(sources.terms).toEqual([]);
        expect(sources.notes).toEqual([]);
    });
});

describe('questions and answers', () => {
    const read = (body: string) => {
        const tree = parse(body);
        remarkQa()(tree as never);
        const blocks = (tree.children ?? []).filter(n => has(n, 'k-qa'));
        for (const b of blocks) expect(has(b.children![0], QA_QUESTION_CLASS) && has(b.children![1], QA_ANSWER_CLASS)).toBe(true);
        return blocks.map(b => [textOf(b.children![0]), textOf(b.children![1])]);
    };

    it('draws a Q: line with an A: line under it, and only that', () => {
        expect(read('Q: One?\nA: First.\nQ: Two?\nA: Second\nline.')).toEqual([['One?', 'First.'], ['Two?', 'Second\nline.']]);
        expect(read('**Q:** Bold?\n**A:** Yes.')).toEqual([['Bold?', 'Yes.']]);
        expect(read('Q: Alone?\n\nA: Too late.')).toEqual([]);
        expect(read('The Q: here\nA: is nothing.')).toEqual([]);
        expect(read('> Q: Quoted?\n> A: No.')).toEqual([]);
    });

    it('writes a selection as a pair that reads back', () => {
        // `[` and `]` mark the selection.
        const write = (marked: string) => {
            const start = marked.indexOf('[');
            const end = marked.indexOf(']') - 1;
            const value = marked.replace('[', '').replace(']', '');
            const made = qaFromSelection(value, start, end)!;
            return value.slice(0, start) + made.insert + value.slice(end);
        };
        expect(read(write('[Which verbs?\nMotion ones.]'))).toEqual([['Which verbs?', 'Motion ones.']]);
        expect(read(write('Intro [asked here\nanswered here] tail.\nNext.'))).toEqual([['asked here', 'answered here']]);
        expect(read(write('[Q: Marked?\nA: Yes.]'))).toEqual([['Marked?', 'Yes.']]);
        expect(qaFromSelection('a  \n b', 1, 3)).toBeNull();
    });
});

describe('callouts', () => {
    const read = (body: string) => {
        const tree = parse(body);
        remarkCallouts()(tree as never);
        const quote = tree.children![0];
        return [quote.data?.hProperties?.className?.join(' ') ?? '', ...(quote.children ?? []).map(textOf)];
    };

    it('marks a quote that starts with a known mark', () => {
        expect(read('> [!NOTE]\n> Hello.')).toEqual(['k-callout k-callout-note', 'Note', 'Hello.']);
        expect(read('> [!TIP]  \n> Two spaces.')).toEqual(['k-callout k-callout-tip', 'Tip', 'Two spaces.']);
        expect(read('> [!CAUTION]\n>\n> Para.')).toEqual(['k-callout k-callout-caution', 'Caution', 'Para.']);
    });

    it('leaves any other quote alone', () => {
        expect(read('> plain')).toEqual(['', 'plain']);
        expect(read('> [!OTHER]\n> x')[0]).toBe('');
        expect(read('> [!WARNING] on the same line')[0]).toBe('');
        expect(read('> [!NOTE]- Folded\n> x')[0]).toBe('');
    });

    // The Notes section's: Obsidian's fold signs and a title of the callout's own.
    const readFoldable = (body: string) => {
        const tree = parse(body);
        remarkCallouts({ foldable: true })(tree as never);
        const quote = tree.children![0];
        const fold = (quote.data?.hProperties as { dataFold?: string } | undefined)?.dataFold ?? 'none';
        return [quote.data?.hProperties?.className?.join(' ') ?? '', fold, ...(quote.children ?? []).map(textOf)];
    };

    it('folds a callout written with a sign, in the Notes section', () => {
        expect(readFoldable('> [!NOTE]- Worked example\n> Hidden at first.')).toEqual(['k-callout k-callout-note', 'closed', 'Worked example', 'Hidden at first.']);
        expect(readFoldable('> [!tip]+\n> Open at first.')).toEqual(['k-callout k-callout-tip', 'open', 'Tip', 'Open at first.']);
        expect(readFoldable('> [!WARNING] A **bold** title\n> Body.')).toEqual(['k-callout k-callout-warning', 'none', 'A bold title', 'Body.']);
        expect(readFoldable('> [!CAUTION]\n> As before.')).toEqual(['k-callout k-callout-caution', 'none', 'Caution', 'As before.']);
        expect(readFoldable('> [!NOTE]-\n>\n> A paragraph.')).toEqual(['k-callout k-callout-note', 'closed', 'Note', 'A paragraph.']);
        expect(readFoldable('> [!OTHER]- x')[0]).toBe('');
    });
});

describe('flashcard decks', () => {
    const terms = [
        { term: 'A', definition: 'a', drives: [':MWD-CH1'] },
        { term: 'B', definition: 'b', drives: [':MWD'] },
        { term: 'C', definition: 'c', drives: [] },
        { term: 'Tag', definition: '', drives: [':MWD'] },
    ];

    it('a Drive covers itself and what is beneath it', () => {
        expect(driveCovers(':MWD', ':MWD-CH1')).toBe(true);
        expect(driveCovers(':MWD', ':MWDX')).toBe(false);
        expect(driveCovers(':MWD-CH1', ':MWD')).toBe(false);
    });

    it('studies terms with a definition, by Drive', () => {
        expect(studyTerms(terms, ALL_TERMS).map(t => t.term)).toEqual(['A', 'B', 'C']);
        expect(studyTerms(terms, ':MWD').map(t => t.term)).toEqual(['A', 'B']);
        expect(studyDecks(terms)).toEqual([{ drive: ':MWD', count: 2 }, { drive: ':MWD-CH1', count: 1 }]);
    });
});

describe("a log's entry template", () => {
    it('gives a day its weekday\'s text, or the one for any day', () => {
        // 2026-10-10 is a Saturday, 2026-10-11 a Sunday.
        const template = { all: 'Gym: {{weekday}}', days: ['Rest', '', '', '', '', '', ''] };
        expect(entryTemplateFor(template, '2026-10-10')).toBe('Gym: Saturday');
        expect(entryTemplateFor(template, '2026-10-11')).toBe('Rest');
        expect(entryTemplateFor({ all: '', days: ['', '', '', '', '', '', 'Long run'] }, '2026-10-09')).toBe('');
        expect(entryTemplateFor({ all: 'Day of {{date}}', days: [] }, '2026-10-10')).toContain('2026');
        expect(entryTemplateFor(null, '2026-10-10')).toBe('');
        expect(hasEntryTemplate(template)).toBe(true);
        expect(hasEntryTemplate({ all: ' ', days: ['', ''] })).toBe(false);
    });
});

describe('note templates', () => {
    it('fills in the date', () => {
        const filled = fillTemplate('Week of {{date}} / {{ DATE }}', '2026-10-10');
        expect(filled).not.toContain('{{');
        expect(filled).toContain('2026');
    });

    it('knows a note that is still only its template', () => {
        const weekly = BUILT_IN_TEMPLATES.find(t => t.name === 'Weekly Review')!;
        const title = fillTemplate(weekly.title, '2026-09-01');
        const body = fillTemplate(weekly.body, '2026-09-01');
        expect(isUntouchedTemplate(title, body, BUILT_IN_TEMPLATES)).toBe(true);
        expect(isUntouchedTemplate(title, `${body}read chapter 4`, BUILT_IN_TEMPLATES)).toBe(false);
        expect(isUntouchedTemplate('My week', body, BUILT_IN_TEMPLATES)).toBe(false);
        expect(isUntouchedTemplate('', 'Q: (why?)\nA: ', [{ name: 'Mine', title: '', body: 'Q: (why?)\nA: ' }])).toBe(true);
        expect(isUntouchedTemplate('', '', BUILT_IN_TEMPLATES)).toBe(false);
    });
});
