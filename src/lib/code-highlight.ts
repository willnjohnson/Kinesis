import rehypeHighlight from 'rehype-highlight';
import type { Options } from 'react-markdown';

/**
 * Colors the code in a fenced block that names its language:
 *
 *     ```cpp
 *     int main() { return 0; }
 *     ```
 *
 * Pass as `rehypePlugins={CODE_HIGHLIGHT}` to a Markdown view. It marks each keyword, string, comment and so on with a
 * class (highlight.js's `hljs-*`); index.css gives those the active theme's code colors (lib/themes.ts's `syntax`), so a
 * block reads as its theme does in an editor. The languages are highlight.js's common set (about three dozen: C, C++,
 * C#, Python, JavaScript, TypeScript, Java, Go, Rust, Kotlin, Swift, PHP, Ruby, SQL, Bash, JSON, YAML, HTML/XML, CSS,
 * Markdown, diff and more). A block that names none, or one this doesn't know, is left as plain text: guessing a
 * language from a few lines colors prose as code.
 */
export const CODE_HIGHLIGHT: NonNullable<Options['rehypePlugins']> = [[rehypeHighlight, { detect: false }]];
