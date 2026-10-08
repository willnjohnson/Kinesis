import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, History, X } from 'lucide-react';
import { completeVideo, listContinueWatching, listWatchedVideos, setVideoWatched, videoThumbnail, WATCH_LISTS_CHANGED_EVENT, type ListedVideo } from '../api';
import { formatClock } from '../lib/remark-timestamps';
import { Modal } from './Modal';

export type WatchList = 'continue' | 'watched';

/** One of the two lists, kept current (they change as videos play, end, or are marked). */
export function useWatchList(list: WatchList) {
    const [videos, setVideos] = useState<ListedVideo[] | null>(null);
    const refresh = useCallback(() => {
        (list === 'continue' ? listContinueWatching() : listWatchedVideos()).then(setVideos).catch(() => setVideos([]));
    }, [list]);
    useEffect(() => {
        refresh();
        window.addEventListener(WATCH_LISTS_CHANGED_EVENT, refresh);
        return () => window.removeEventListener(WATCH_LISTS_CHANGED_EVENT, refresh);
    }, [refresh]);
    return { videos, refresh };
}

/** "Oct 6" for the stored "2026-10-06 14:03:12.000" (UTC), with the year when it isn't this one. */
function dayOf(at: string): string {
    const d = new Date(`${at.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * The pin menu's Continue Watching and Watched windows. Continue Watching: saved videos started and not finished, each
 * with how far in it is; Mark as Completed moves one to Watched and checks it off on its Calendar tracks. Watched: every
 * video finished (played to its end, or marked), each of which can be unmarked. Picking a video opens it in the sidebar,
 * where Continue Watching's offer to resume is waiting.
 */
export function WatchListsModal({ list, onClose, onOpenVideo }: {
    list: WatchList;
    onClose: () => void;
    onOpenVideo: (videoId: string) => void;
}) {
    const { videos } = useWatchList(list);
    const [busy, setBusy] = useState<string | null>(null);
    const continuing = list === 'continue';

    const act = async (id: string, run: () => Promise<unknown>) => {
        setBusy(id);
        try { await run(); } catch (e) { console.error(e); }
        setBusy(null);
    };

    return (
        <Modal
            onClose={onClose}
            layer="top"
            icon={continuing ? History : CheckCheck}
            title={continuing ? 'Continue Watching' : 'Watched'}
            subtitle={continuing ? 'Videos you started and haven’t finished' : 'Videos you finished, the latest first'}
            size="lg"
            bodyClassName="p-0"
        >
            {videos === null ? (
                <p className="px-6 py-10 text-center text-sm text-[#888888]">Loading...</p>
            ) : videos.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-[#888888]">
                    {continuing
                        ? 'Nothing in progress. A saved video you stop partway through shows up here.'
                        : 'Nothing watched yet. A video you finish, or mark completed, shows up here.'}
                </p>
            ) : (
                <ul className="divide-y divide-[#272727] max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {videos.map(v => {
                        const pct = v.seconds !== null && v.duration ? Math.min(100, (v.seconds / v.duration) * 100) : null;
                        return (
                            <li key={v.videoId} className="px-6 py-3 flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={() => { onClose(); onOpenVideo(v.videoId); }}
                                    className="min-w-0 flex-1 flex items-center gap-3 text-left cursor-pointer group"
                                    title={`Open "${v.title}"`}
                                >
                                    <span className="relative w-24 h-[54px] shrink-0 rounded overflow-hidden bg-[#272727]">
                                        <img src={videoThumbnail(v.videoId)} alt="" className="w-full h-full object-cover" />
                                        {/* How far in, as YouTube shows it: a red bar along the thumbnail's bottom. */}
                                        {pct !== null && (
                                            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                                                <span className="block h-full bg-red-600" style={{ width: `${pct}%` }} />
                                            </span>
                                        )}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-white truncate group-hover:text-[var(--k-accent)] transition-colors">{v.title || v.videoId}</span>
                                        <span className="block text-xs text-[#888888] truncate">
                                            {[
                                                v.author,
                                                continuing && v.seconds !== null && `${formatClock(Math.floor(v.seconds))}${v.duration ? ` of ${formatClock(Math.floor(v.duration))}` : ''}`,
                                                dayOf(v.at),
                                            ].filter(Boolean).join(' · ')}
                                        </span>
                                    </span>
                                </button>
                                {continuing ? (
                                    <button
                                        type="button"
                                        onClick={() => { void act(v.videoId, () => completeVideo(v.videoId)); }}
                                        disabled={busy === v.videoId}
                                        title="Move it to Watched, and check it off on its Calendar tracks"
                                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#222222] border border-[#383838] hover:bg-[#3f3f3f] disabled:opacity-50 cursor-pointer text-gray-200 hover:text-white text-xs font-semibold transition-colors"
                                    >
                                        <Check className="w-3.5 h-3.5" /> Mark as Completed
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { void act(v.videoId, () => setVideoWatched(v.videoId, false)); }}
                                        disabled={busy === v.videoId}
                                        title="Not watched (takes it off this list)"
                                        className="shrink-0 p-1.5 text-[#888888] hover:text-red-400 disabled:opacity-50 cursor-pointer transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </Modal>
    );
}
