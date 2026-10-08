import { useCallback, useEffect, useState } from 'react';
import { Unlink, X } from 'lucide-react';
import { deleteVideo, deleteVideos, listOrphanedVideos, ORPHANS_CHANGED_EVENT, TRASH_CHANGED_EVENT, videoThumbnail, type OrphanedVideo } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { SecondaryButton } from './ui/Button';

/** The saved videos YouTube no longer has, kept current: reloads when one is found gone or answers again, and when
 *  the Trash changes (a deleted video leaves the list). */
export function useOrphans() {
    const [videos, setVideos] = useState<OrphanedVideo[]>([]);
    const refresh = useCallback(() => { listOrphanedVideos().then(setVideos).catch(() => setVideos([])); }, []);
    useEffect(() => {
        refresh();
        window.addEventListener(ORPHANS_CHANGED_EVENT, refresh);
        window.addEventListener(TRASH_CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener(ORPHANS_CHANGED_EVENT, refresh);
            window.removeEventListener(TRASH_CHANGED_EVENT, refresh);
        };
    }, [refresh]);
    return { videos, count: videos.length };
}

/** "Sep 7, 2026" for the stored "2026-09-07 14:03:12.000" (UTC). */
function foundOn(at: string): string {
    const d = new Date(`${at.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The Library's orphaned videos: saved videos YouTube no longer has (found when one is opened in the sidebar). They
 * stay in the Library for the record; here each can be opened or deleted, like the Trash window's list. Deleting
 * sends it to the Trash, so it can still be put back this session.
 */
export function OrphanedModal({ onClose, onOpenVideo, allowDeletion }: {
    onClose: () => void;
    onOpenVideo: (videoId: string) => void;
    allowDeletion: boolean;
}) {
    const { videos } = useOrphans();
    const { labels } = useWorkspace();
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmAll, setConfirmAll] = useState(false);

    const remove = async (id: string) => {
        setBusy(id);
        try { await deleteVideo(id); } catch (e) { console.error('Failed to delete video:', e); }
        setBusy(null);
    };
    // All at once, in one go (not one by one): each still lands in the Trash as its own item.
    const removeAll = async () => {
        setConfirmAll(false);
        try { await deleteVideos(videos.map(v => v.videoId)); } catch (e) { console.error('Failed to delete videos:', e); }
    };

    return (
        <Modal
            onClose={onClose}
            icon={Unlink}
            title={`Orphaned: ${labels.aliasLibrary}`}
            subtitle="Videos YouTube no longer has, kept here for the record"
            size="lg"
            bodyClassName="p-0"
            footer={
                <>
                    {allowDeletion && (
                        <SecondaryButton onClick={() => setConfirmAll(true)} disabled={videos.length === 0}>
                            Delete All
                        </SecondaryButton>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 cursor-pointer text-white text-sm font-semibold transition-colors"
                    >
                        Close
                    </button>
                </>
            }
        >
            {videos.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-[#888888]">
                    No orphaned videos. A saved video YouTube no longer has shows up here once it's opened.
                </div>
            ) : (
                <ul className="divide-y divide-[#272727]">
                    {videos.map(v => (
                        <li key={v.videoId} className="px-6 py-3 flex items-center gap-4">
                            <button
                                type="button"
                                onClick={() => { onClose(); onOpenVideo(v.videoId); }}
                                className="min-w-0 flex-1 flex items-center gap-3 text-left cursor-pointer group"
                                title={`Open "${v.title}"`}
                            >
                                <img src={videoThumbnail(v.videoId)} alt="" className="w-16 h-9 object-cover rounded shrink-0 opacity-60" />
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-white truncate group-hover:text-[var(--k-accent)] transition-colors">{v.title || v.videoId}</span>
                                    <span className="block text-xs text-[#888888] truncate">
                                        {[v.author, v.reason, foundOn(v.foundAt) && `found ${foundOn(v.foundAt)}`].filter(Boolean).join(' · ')}
                                    </span>
                                </span>
                            </button>
                            {allowDeletion && (
                                <button
                                    type="button"
                                    onClick={() => { void remove(v.videoId); }}
                                    disabled={busy === v.videoId}
                                    title="Delete (to the Trash)"
                                    className="shrink-0 p-1.5 text-[#888888] hover:text-red-400 disabled:opacity-50 cursor-pointer transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {confirmAll && (
                <ConfirmDialog
                    title="Delete Orphaned Videos"
                    confirmLabel="Delete All"
                    message={`Delete all ${videos.length} orphaned video${videos.length === 1 ? '' : 's'}? They go to the Trash, so they can still be put back until you quit.`}
                    onConfirm={() => { void removeAll(); }}
                    onCancel={() => setConfirmAll(false)}
                />
            )}
        </Modal>
    );
}

/** "2 Orphaned" for the Library's status bar, beside the Trash chip: shown while there are any. A click opens the
 *  Orphaned window. Narrow bars show just the icon, as the Trash chip does. */
export function OrphanedChip({ wide, onOpenVideo, allowDeletion }: {
    /** Whether the bar is wide enough for the words (the same width the Trash chip's words need). */
    wide: '4xl' | '6xl';
    onOpenVideo: (videoId: string) => void;
    allowDeletion: boolean;
}) {
    const { count } = useOrphans();
    const [open, setOpen] = useState(false);
    if (count === 0 && !open) return null;
    return (
        <>
            {count > 0 && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    title={`${count} orphaned (YouTube no longer has ${count === 1 ? 'it' : 'them'})`}
                    aria-label={`${count} orphaned`}
                    className="shrink-0 flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:text-white hover:bg-[#272727] transition-colors cursor-pointer"
                >
                    <Unlink className={`w-3 h-3 ${wide === '6xl' ? '@6xl:hidden' : '@4xl:hidden'}`} />
                    <span className={`hidden ${wide === '6xl' ? '@6xl:inline' : '@4xl:inline'}`}><span className="text-white">{count}</span> Orphaned</span>
                </button>
            )}
            {open && <OrphanedModal onClose={() => setOpen(false)} onOpenVideo={onOpenVideo} allowDeletion={allowDeletion} />}
        </>
    );
}
