import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { CODE_HIGHLIGHT } from '../lib/code-highlight';
import remarkGfm from 'remark-gfm';
import { remarkHighlight } from '../lib/remark-highlight';
import { remarkCallouts } from '../lib/remark-callouts';
import { remarkTimestamps } from '../lib/remark-timestamps';
import { remarkEmbeds } from '../lib/remark-embeds';
import { markdownUrlTransform } from '../lib/internal-links';
import { handleMarkdownKeyDown, handleMarkdownContextMenu } from '../lib/markdown-editor';
import { MarkdownLink } from './MarkdownLink';
import { MENTIONS_ATTR } from './MentionGhost';

/** A labelled Markdown text area with an eye toggle in its label row that swaps it for a preview of
 *  how the text will read, rendered the same way the Glossary/Biography readers render it. The
 *  preview keeps the text area's height (rows × line height), so toggling doesn't make the dialog jump. */
export function MarkdownField({ label, value, onChange, rows, placeholder, required, autoFocus, focusColor = 'blue' }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows: number;
    placeholder?: string;
    required?: boolean;
    /** Puts the cursor in the text area when the field first appears. */
    autoFocus?: boolean;
    focusColor?: 'blue' | 'red';
}) {
    const [previewing, setPreviewing] = useState(false);
    // text-sm line height (1.25rem) per row, plus py-3.
    const height = `calc(${rows * 1.25}rem + 1.5rem + 2px)`;
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</label>
                {/* Same toggle as the Sidebar's Summary/Transcript editors. -my-1: its padding doesn't heighten the label row. */}
                <button
                    type="button"
                    onClick={() => setPreviewing(p => !p)}
                    className="-my-1 p-1 rounded-lg hover:bg-[#272727] transition-colors text-[#aaaaaa] hover:text-white cursor-pointer"
                    title={previewing ? 'Back to Edit' : 'Preview'}
                >
                    {previewing ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </div>
            {previewing ? (
                <div style={{ height }} className="w-full bg-[#121212] border border-[#333] rounded-xl px-4 py-3 overflow-y-auto">
                    {value.trim() ? (
                        <div className="leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-pre:bg-black/50 prose-code:text-red-400">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkCallouts, remarkHighlight, [remarkTimestamps, { chips: false }], remarkEmbeds]}
                                rehypePlugins={CODE_HIGHLIGHT}
                                urlTransform={markdownUrlTransform}
                                components={{
                                    a: MarkdownLink,
                                    img: ({ node, ...props }) => <img {...props} className="rounded-xl border border-white/10" />,
                                }}
                            >
                                {value}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-600 italic">Nothing to preview.</p>
                    )}
                </div>
            ) : (
                <textarea
                    required={required}
                    autoFocus={autoFocus}
                    // "@" suggests a Biography handle to link (components/MentionGhost.tsx).
                    {...{ [MENTIONS_ATTR]: '' }}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onContextMenu={handleMarkdownContextMenu}
                    onKeyDown={(e) => handleMarkdownKeyDown(e, value, onChange)}
                    rows={rows}
                    className={`w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none ${focusColor === 'red' ? 'focus:border-red-600' : 'focus:border-blue-600'} transition-all resize-none placeholder-gray-600`}
                    placeholder={placeholder}
                />
            )}
        </div>
    );
}
