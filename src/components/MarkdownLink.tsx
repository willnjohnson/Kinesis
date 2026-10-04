import { isValidElement, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { decodeWdbs } from '../api';
import { parseInternalHref, openInternalLink, linkKindLabel } from '../lib/internal-links';
import { openExternalUrlGuarded } from '../lib/external-links';
import { formatClock } from '../lib/remark-timestamps';
import { useCreatorMenu } from './CreatorMenu';
import { useWorkspace } from '../hooks/useWorkspace';
import { useBioLinkPreview, useGlossaryPreview } from './GlossaryPreview';
import { useSequenceLinkPreview } from './SequenceCard';
import { useVideoPreview } from './VideoPreview';
import { PlaylistEmbed, VideoEmbed } from './LinkEmbed';

/** A link's text as plain words (its children can be formatting, not just a string). */
function textOf(node: ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
    return '';
}

/**
 * The link renderer for every markdown view (pass as `components={{ a: MarkdownLink }}` together
 * with `urlTransform={markdownUrlTransform}`). An ordinary link opens in the browser; an in-app
 * link (`kinesis://glossary/...`) opens that part of the app.
 */
export function MarkdownLink({ href, title, children, 'data-embed': embed }: { href?: string; title?: string; children?: ReactNode; 'data-embed'?: string }) {
    const { labels } = useWorkspace();
    const internal = parseInternalHref(href);
    // A glossary link previews its definition on hover, in place of the plain tooltip the other kinds get.
    const preview = useGlossaryPreview(internal?.kind === 'glossary' ? internal.key : '');
    const bioPreview = useBioLinkPreview(internal?.kind === 'bio' ? internal.key : '');
    // A playlist link previews as a playlist card (first video's thumbnail, how many videos, what it starts with).
    const sequencePreview = useSequenceLinkPreview(internal?.kind === 'playlist' ? internal.key : '');
    // A video link previews as the video's card.
    const videoPreview = useVideoPreview(internal?.kind === 'video' ? internal.key : '');
    // A biography link's right-click: Visit YouTube Channel, Open Biography.
    const creatorMenu = useCreatorMenu(internal?.kind === 'bio' ? internal.key : null);
    if (internal) {
        const target = internal.kind === 'drive' ? decodeWdbs(internal.key) || internal.key : internal.key;
        const hover = internal.kind === 'glossary' ? preview
            : internal.kind === 'bio' ? bioPreview
            : internal.kind === 'playlist' ? sequencePreview
            : internal.kind === 'video' ? videoPreview
            : null;
        const link = (
            <>
                <a
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        openInternalLink(internal.kind, internal.key, internal.at);
                    }}
                    title={hover ? undefined : `${linkKindLabel(internal.kind, labels)}: ${target}${internal.at !== undefined ? ` at ${formatClock(internal.at)}` : ''}`}
                    {...(hover ? hover.handlers : {})}
                    onContextMenu={creatorMenu.onContextMenu}
                    // The real target doesn't otherwise survive into the DOM (href above is just
                    // "#") — this is what a Terms chip's jump-to-summary click looks for
                    // (see Sidebar.tsx's handleJumpToTerm).
                    {...(internal.kind === 'glossary' ? { 'data-glossary-term': internal.key } : {})}
                    // And for "Copy as Markdown" on a selection (lib/selection-markdown.ts), the link's real address.
                    data-md-href={href}
                    className="text-red-500 hover:text-red-400 underline decoration-dotted decoration-red-500/60 underline-offset-4"
                >
                    {children}
                    {/* A video link that starts partway through says where, after its text: a play icon and the time in a
                        tinted chip (shaped like a [1:23] timestamp chip, lib/remark-timestamps.ts), so it reads as "plays
                        from here". Same size and font as the paragraph around it (tabular-nums keeps the digits even).
                        inline-flex keeps the link's dotted underline off it. */}
                    {internal.at !== undefined && (
                        <span
                            className="ml-1.5 inline-flex items-center gap-1 rounded px-1.5 tabular-nums leading-snug align-baseline bg-red-500/15 text-red-400"
                            aria-label={`starts at ${formatClock(internal.at)}`}
                            // Copied as markdown, the time is already in the link's address.
                            data-md-skip=""
                        >
                            <Play className="w-[0.7em] h-[0.7em] fill-current" />
                            {formatClock(internal.at)}
                        </span>
                    )}
                </a>
                {hover?.card}
                {creatorMenu.menu}
            </>
        );
        // On a line of its own (lib/remark-embeds.ts marks it), a video or playlist link shows as its card; the plain
        // link is what shows if the target is gone. Copied as markdown, the card is the link it was written as.
        const asMarkdown = `[${textOf(children)}](${href})`;
        if (embed && internal.kind === 'video') return <span className="contents" data-md-replace={asMarkdown}><VideoEmbed videoId={internal.key} at={internal.at} fallback={link} /></span>;
        if (embed && internal.kind === 'playlist') return <span className="contents" data-md-replace={asMarkdown}><PlaylistEmbed drive={internal.key} fallback={link} /></span>;
        return link;
    }
    return (
        <a
            href="#"
            title={title}
            onClick={(e) => {
                e.preventDefault();
                if (href) openExternalUrlGuarded(href, typeof children === 'string' ? children : title);
            }}
            data-md-href={href}
            className="text-red-500 hover:text-red-400 underline decoration-red-500/30 underline-offset-4"
        >
            {children}
        </a>
    );
}
