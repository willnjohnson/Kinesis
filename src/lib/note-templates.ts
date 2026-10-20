import { getSetting, setSetting } from '../api';

/**
 * Note templates: what a new note can start from, instead of a blank page. A few come with the app; the rest are the
 * workspace's own, made from a note with "Save This Note as a Template" and kept in the workspace's settings (one
 * JSON list under `noteTemplates`), so they're there for whoever opens the workspace.
 *
 * A template is a name, and the title and text a note made from it starts with. Placeholders `{{monthName}}`, `{{year}}`, `{{season}}` are supported.
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
        body: '## Key points\n\n- \n\n## Details\n\n\n\n## Questions\n\n> [!QA]\n> \n> ---\n> \n\n## To follow up\n\n- [ ] ',
    },
    {
        name: 'Weekly Review',
        title: 'Week of {{monthName}} {{year}}',
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
        body: '> [!QA]\n> \n> ---\n> \n\n> [!QA]\n> \n> ---\n> \n\n> [!QA]\n> \n> ---\n> ',
    },
    {
        name: 'Full Sample',
        title: '',
        body: '# Full Sample\n## A Complete Demonstration of Markdown Elements\n\n**Template:** Full Sample  \n**Category:** Demonstration  \n**Estimated reading time:** 6–8 minutes\n\n---\n\n## Featured Quote\n\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam in dui mauris. Vivamus hendrerit arcu sed erat molestie vehicula. Sed auctor neque eu tellus rhoncus ut eleifend nibh porttitor.\n> \n> — [Lorem Ipsum Reference](https://www.lipsum.com/)\n\n### Video Quotes & Thoughts\n\n#### Quote from video\n\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque volutpat condimentum velit. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nam nec ante. Sed lacinia, urna non tincidunt mattis, tortor neque adipiscing diam, a cursus ipsum ante quis turpis.\n> \n> — [Lorem Ipsum Video](kinesis://video/placeholder?t=130)\n\n#### Thought from video\n\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque volutpat condimentum velit. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nam nec ante. Sed lacinia, urna non tincidunt mattis, tortor neque adipiscing diam, a cursus ipsum ante quis turpis.\n> \n> — on [Lorem Ipsum Video](kinesis://video/placeholder?t=130)\n\n---\n\n## 1. Introduction & Objectives\n\n### Learning Objectives\n\nBy the end of this sample, you should be able to recognize and use the following elements:\n\n- Headings, paragraphs, and emphasis styles\n- Blockquotes, callouts, and alerts\n- Mathematical expressions and formulas\n- Tables, lists, and task lists\n- Code blocks with syntax highlighting\n- Links, references, and embedded resources\n- Knowledge checks and study aids\n\n> [!NOTE]\n> **About this template**\n> \n> This is a non-subject-specific sample template. All content is placeholder "Lorem ipsum" text used solely to demonstrate formatting. It does not contain factual information.\n\n---\n\n## 2. Text Formatting & Typography\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. *This is italicized placeholder text.* Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. **This is bold placeholder text.** Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n\nYou can also combine styles: ***Bold and italic lorem ipsum.*** Or use ~~strikethrough for deprecated nonsense.~~ Inline code like `lorem_ipsum()` can also be used within a sentence.\n\n### 2.1 Subheadings & Hierarchy\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Proin quis tortor orci. Etiam at risus et justo dignissim congue.\n\n#### 2.1.1 Fourth-Level Heading\nVestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae. Donec velit neque, auctor sit amet aliquam vel, ullamcorper sit amet ligula.\n\n##### 2.1.2 Fifth-Level Heading\nPraesent sapien massa, convallis a pellentesque nec, egestas non nisi. Mauris blandit aliquet elit, eget tincidunt nibh pulvinar a.\n\n###### 2.1.3 Sixth-Level Heading\nCurabitur aliquet quam id dui posuere blandit. Pellentesque in ipsum id orci porta dapibus.\n\n---\n\n## 3. Callouts & Alerts\n\n> [!TIP]\n> **Tip Callout**\n> \n> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam. Sed nisi. Nulla quis sem at nibh elementum imperdiet.\n\n> [!TIP]+ **Expandable Tip**\n> **More details:**\n> \n> Duis sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue semper porta. Mauris massa. Vestibulum lacinia arcu eget nulla. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.\n> \n> $$ E = mc^2 $$ \n> *(Placeholder formula for demonstration purposes.)*\n\n> [!IMPORTANT]\n> **Important Callout**\n> \n> Nulla metus metus, ullamcorper vel, tincidunt sed, euismod in, nibh. Quisque volutpat condimentum velit. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.\n\n> [!WARNING]\n> **Warning Callout**\n> \n> Nam nec ante. Sed lacinia, urna non tincidunt mattis, tortor neque adipiscing diam, a cursus ipsum ante quis turpis. Nulla facilisi. Ut fringilla. Suspendisse potenti. Nunc feugiat mi a tellus consequat imperdiet.\n\n> [!CAUTION]\n> **Caution Callout**\n> \n> Vestibulum sapien. Proin quam. Etiam ultrices. Suspendisse in justo eu magna luctus suscipit. Sed lectus. Integer euismod lacus luctus magna.\n\n---\n\n## 4. Mathematics & Equations\n\n### 4.1 Inline Mathematics\n\nLorem ipsum dolor sit amet, \\( f(x) = ax^2 + bx + c \\) consectetur adipiscing elit. Curabitur non nulla sit amet nisl tempus convallis quis ac lectus. Another example: \\( \\sum_{i=1}^{n} x_i = x_1 + x_2 + \\ldots + x_n \\).\n\n### 4.2 Block Mathematics\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Aenean commodo ligula eget dolor:\n\n$$\nS_n = \\frac{n}{2}(a_1 + a_n)\n$$\n\nNulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. Another example:\n\n$$\n\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)\n$$\n\n---\n\n## 5. Lists, Checklists, & Organization\n\n### 5.1 Unordered Lists\n\n- Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n- Quisque nisl felis, venenatis tristique, dignissim in, ultrices sit amet, augue.\n  - Proin sodales libero eget ante. Nulla quam.\n  - Aenean laoreet. Vestibulum nisi lectus, commodo ac, facilisis ac, ultricies eu, pede.\n- Ut orci risus, accumsan porttitor, cursus quis, aliquet eget, justo.\n\n### 5.2 Ordered Lists\n\n1. Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n2. Fusce lacinia arcu et nulla. Nulla vitae mauris non felis mollis faucibus.\n3. Morbi in dui quis est pulvinar ullamcorper. Nulla facilisi.\n   1. Integer lacinia sollicitudin massa. Cras metus.\n   2. Sed aliquet risus a tortor. Integer id quam.\n4. Mauris ipsum. Nulla metus metus, ullamcorper vel, tincidunt sed.\n\n### 5.3 Task Lists (Checklists)\n\n- [x] Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n- [x] Vestibulum ante ipsum primis in faucibus orci luctus.\n- [ ] Proin sodales libero eget ante. Nulla quam.\n- [ ] Aenean laoreet. Vestibulum nisi lectus, commodo ac, facilisis ac.\n- [ ] Ut orci risus, accumsan porttitor, cursus quis, aliquet eget, justo.\n\n---\n\n## 6. Tables\n\n### 6.1 Basic Table\n\n| Element | Placeholder | Category |\n|---|---|---|\n| Lorem | Dolor sit amet | Consectetur |\n| Adipiscing | Elit sed do | Eiusmod |\n| Tempor | Incididunt ut | Labore |\n| Dolore | Magna aliqua | Enim ad |\n\n### 6.2 Aligned Table\n\n| Column Left | Column Center | Column Right |\n|:---|:---:|---:|\n| Lorem ipsum | Dolor sit amet | 100 |\n| Consectetur | Adipiscing elit | 250 |\n| Eiusmod tempor | Incididunt ut labore | 500 |\n\n### 6.3 Complex Table\n\n| Category | Description | Status | Notes |\n|---|---|---|---|\n| Alpha | Lorem ipsum dolor sit amet, consectetur adipiscing elit. | Complete | Nulla quis sem at nibh elementum. |\n| Beta | Quisque volutpat condimentum velit. Class aptent taciti sociosqu. | In Progress | Vestibulum lacinia arcu eget nulla. |\n| Gamma | Nam nec ante. Sed lacinia, urna non tincidunt mattis. | Pending | Suspendisse potenti. Nunc feugiat mi. |\n\n---\n\n## 7. Code Blocks & Syntax\n\n### 7.1 Plain Text\n\n```text\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n```\n\n### 7.2 JavaScript\n\n```javascript\nfunction loremIpsum(count) {\n  const placeholder = "Lorem ipsum dolor sit amet";\n  return Array(count).fill(placeholder).join(" ");\n}\n\nconsole.log(loremIpsum(3));\n```\n\n### 7.3 Python\n\n```python\ndef generate_placeholder(words=5):\n    """Return a simple lorem ipsum placeholder string."""\n    base = ["lorem", "ipsum", "dolor", "sit", "amet"]\n    return " ".join(base[:words])\n\nprint(generate_placeholder(5))\n```\n\n### 7.4 C++\n\n```cpp\n#include <iostream>\n#include <string>\n\nint main() {\n    std::string placeholder = "Lorem ipsum dolor sit amet";\n    std::cout << placeholder << std::endl;\n    return 0;\n}\n```\n\n### 7.5 JSON\n\n```json\n{\n  "title": "Full Sample",\n  "category": "demonstration",\n  "elements": [\n    "headings",\n    "callouts",\n    "tables",\n    "code"\n  ],\n  "active": true\n}\n```\n\n### 7.6 Markdown\n\n```markdown\n## Lorem Ipsum Heading\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n- [ ] Placeholder task\n```\n\n---\n\n## 8. Links, References, & Resources\n\n### 8.1 External Links\n\n- [Lorem Ipsum Generator](https://www.lipsum.com/) – Generate placeholder text\n- [CommonMark Specification](https://spec.commonmark.org/) – Markdown reference\n- [GitHub Flavored Markdown](https://github.github.com/gfm/) – GFM documentation\n\n### 8.2 Internal/Embedded References\n\n**Glossary Term:** [Lorem Ipsum](https://www.lipsum.com/)  \n**Flashcards:** [Demo Flashcards](kinesis://flashcards/demo-sample)  \n**Video Reference:** [Lorem Ipsum Placeholder Video](kinesis://video/placeholder?t=30)\n\n---\n\n## 9. Knowledge Check & Study Aids\n\n### Questions\n\n> [!QA]\n> 1. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque volutpat?\n> ---\n> Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.\n\n> [!QA]\n> 2. Vestibulum lacinia arcu eget nulla. Curabitur aliquet quam id dui posuere blandit?\n> ---\n> Pellentesque in ipsum id orci porta dapibus. Vivamus suscipit tortor eget felis porttitor volutpat.\n\n> [!QA]\n> 3. What is the purpose of this template?\n> ---\n> To showcase all supported Markdown elements in a non-subject-specific, Lorem Ipsum style format.\n\n> [!QA]\n> 4. Using the sample formula, complete this placeholder: \\( f(x)=ax^2 + ... \\)?\n> ---\n> \\( f(x)=ax^2 + bx + c \\).\n\n### Study Checklist\n\n- [x] Review headings and text formatting\n- [x] Explore callouts and alerts\n- [x] Practice reading tables and lists\n- [ ] Complete the knowledge check without consulting the answer key\n- [ ] Experiment with adding your own Lorem Ipsum content\n- [ ] Mark any sections you\'d like to customize for future templates\n\n### Personal Notes\n\n> "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero."\n> \n> — Sample reflection note\n\n> "Sed cursus ante dapibus diam. Sed nisi. Nulla quis sem at nibh elementum imperdiet."\n> \n> — Additional placeholder note\n\n---\n\n## 10. Appendix\n\n### Appendix A — Horizontal Rule Example\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n---\n\nFusce nec tellus sed augue semper porta. Mauris massa. Vestibulum lacinia arcu eget nulla.\n\n### Appendix B — Blockquote Variations\n\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.\n> \n> > Nested blockquote: Vestibulum id ligula porta felis euismod semper. Aenean lacinia bibendum nulla sed consectetur.\n> > \n> > > Double nested: Cras mattis consectetur purus sit amet fermentum.\n\n### Appendix C — Final Placeholder\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Proin eget tortor risus. Pellentesque in ipsum id orci porta dapibus. Vivamus magna justo, lacinia eget consectetur sed, convallis at tellus.\n\n**End of Full Sample Template**\n\n---\n\n*This template is intended for demonstration purposes only. All text is generated placeholder content.*',
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
 *  placeholders. Such a note has nothing of the reader's in it yet (it's deleted without asking). */
export function isUntouchedTemplate(title: string, body: string, templates: NoteTemplate[]): boolean {
    const same = (made: string, from: string) => {
        const pattern = from.trim().split(/\{\{\s*date\s*\}\}/i).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
        return new RegExp(`^${pattern}$`, 's').test(made.trim());
    };
    return templates.some(t => same(title, t.title) && same(body, t.body));
}

function getSeason(m: number): 'Spring' | 'Summer' | 'Fall' | 'Winter' {
    if (m >= 3 && m <= 5) return 'Spring';
    if (m >= 6 && m <= 8) return 'Summer';
    if (m >= 9 && m <= 11) return 'Fall';
    return 'Winter'; // 12, 1, 2
}

/** A template's text with placeholders filled in: `{{monthName}}`, `{{year}}`, `{{season}}` filled in for the given
 *  `today` string ("2026-10-10"). */
export function fillTemplate(text: string, today: string): string {
    const [y, m, d] = today.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    const monthName = day.toLocaleDateString(undefined, { month: 'long' });
    return text
        .replace(/\{\{\s*monthName\s*\}\}/gi, monthName)
        .replace(/\{\{\s*year\s*\}\}/gi, String(y))
        .replace(/\{\{\s*season\s*\}\}/gi, getSeason(m));
}
