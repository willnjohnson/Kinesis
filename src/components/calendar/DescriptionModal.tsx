import ReactMarkdown from 'react-markdown';
import { CODE_HIGHLIGHT } from '../../lib/code-highlight';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { remarkHighlight } from '../../lib/remark-highlight';
import { remarkCallouts } from '../../lib/remark-callouts';
import { remarkTimestamps } from '../../lib/remark-timestamps';
import { remarkEmbeds } from '../../lib/remark-embeds';
import { markdownUrlTransform } from '../../lib/internal-links';
import { useSelectableText, SELECTABLE_CLASS } from '../../hooks/useSelectableText';
import { MarkdownLink } from '../MarkdownLink';
import { Modal } from '../Modal';

/** A Calendar item's description, read as the Glossary reads a definition: Markdown with working links (a video, a term,
 *  a person) and highlights, and text that can be selected and copied. The item's menu opens it (Open Description). */
export function DescriptionModal({ title, trackName, description, onClose }: {
    title: string;
    trackName: string;
    description: string;
    onClose: () => void;
}) {
    const selectable = useSelectableText();
    return (
        <Modal onClose={onClose} icon={FileText} title={title} subtitle={trackName} size="lg" closeOnNavigate>
            <div {...selectable.props} className={`${SELECTABLE_CLASS} leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-pre:bg-black/50 prose-code:text-red-400`}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkCallouts, remarkHighlight, [remarkTimestamps, { chips: false }], remarkEmbeds]}
                    rehypePlugins={CODE_HIGHLIGHT}
                    urlTransform={markdownUrlTransform}
                    components={{
                        a: MarkdownLink,
                        img: ({ node, ...props }) => <img {...props} className="rounded-xl border border-white/10" />,
                    }}
                >
                    {description}
                </ReactMarkdown>
            </div>
            {selectable.menu}
        </Modal>
    );
}
