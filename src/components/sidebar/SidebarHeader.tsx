import { Pin, X } from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useCreatorMenu } from '../CreatorMenu';

/**
 * The sidebar's header: the video's thumbnail, title and channel handle (click for its Biography, right-click for the
 * creator menu), and at the right end the pin and close buttons.
 */
export function SidebarHeader({ videoId, title, handle, showBiography, onHandleClick, pinned, onTogglePin, onClose }: {
    videoId?: string;
    title: string;
    handle?: string;
    showBiography?: boolean;
    onHandleClick?: (handle: string) => void;
    pinned: boolean;
    onTogglePin?: () => void;
    /** Closing, through the sidebar's unsaved-changes check. */
    onClose: () => void;
}) {
    const { labels } = useWorkspace();
    const creatorMenu = useCreatorMenu(handle, handle && onHandleClick ? () => onHandleClick(handle.startsWith('@') ? handle : `@${handle}`) : undefined);
    return (
        <div className="px-4 py-2.5 border-b border-[#303030] flex justify-between items-start bg-white/5">
            <div className="flex gap-3 items-start">
                {videoId && (
                    <img
                        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                        alt={title || "Untitled"}
                        className="w-[72px] h-10 shrink-0 object-cover rounded-md"
                    />
                )}
                <div className="flex flex-col gap-0.5 overflow-hidden">
                    <h2 className="text-sm font-semibold text-white pr-8 line-clamp-2 leading-snug">
                        {title || "Untitled"}
                    </h2>
                    {handle && (
                        <button
                            onClick={showBiography ? () => onHandleClick?.(handle.startsWith('@') ? handle : `@${handle}`) : undefined}
                            onContextMenu={creatorMenu.onContextMenu}
                            className={`text-xs text-[#aaaaaa] ${showBiography ? 'hover:text-red-400 cursor-pointer' : ''} text-left`}
                            title={showBiography ? `View ${labels.aliasBiographyItem}` : undefined}
                        >
                            {handle.startsWith('@') ? handle : `@${handle}`}
                        </button>
                    )}
                    {creatorMenu.menu}
                </div>
            </div>
            {/* Pin and close together at the right end. Pinned: filled, in the accent. A pin is the reader's own
                (allowed in a read-only workspace). */}
            <div className="flex items-center shrink-0">
                {onTogglePin && (
                    <button
                        onClick={onTogglePin}
                        title={pinned ? 'Unpin' : 'Pin'}
                        aria-label={pinned ? 'Unpin' : 'Pin'}
                        aria-pressed={pinned}
                        className={`${pinned ? 'text-[var(--k-accent)]' : 'text-[#aaaaaa] hover:text-white'} transition-colors cursor-pointer p-1`}
                    >
                        <Pin className="w-[18px] h-[18px]" fill={pinned ? 'currentColor' : 'none'} />
                    </button>
                )}
                <button onClick={onClose} className="text-[#aaaaaa] hover:text-white transition-colors cursor-pointer p-1">
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
