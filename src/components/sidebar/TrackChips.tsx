import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CircleCheck } from 'lucide-react';
import { listCalendarTracks, setCalendarCompletion, setCalendarProgress, type CalendarEntry, type CalendarTrackSummary } from '../../api';
import { InProgressIcon } from '../ui/MarkIcons';
import { SecondaryButton } from '../ui/Button';
import { Modal } from '../Modal';

/** How far into a video counts as having started it (its track entries go In progress). */
const AUTO_PROGRESS_SECONDS = 30;

/** Where a video sits on one track: the track, its entry for the video, and that entry's place in the list. */
interface Placement {
    summary: CalendarTrackSummary;
    entry: CalendarEntry;
    index: number;
}

/** "Mon, Sep 7" for "2026-09-07". */
function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The Calendar tracks the open video is on, as a strip under the sidebar's header: each says which track, its place in
 * the list ("4 of 12"), its day on a dated track (in red once it's overdue), and has Mark done, so it can be checked off
 * where it's watched, and In progress beside it. Marking is the reader's own (allowed in a read-only workspace, like the Calendar's checkboxes).
 * Clicking the track's name opens it in the Calendar. Nothing shows when the video isn't on a track. When the video
 * plays to its end, a window asks whether to mark it done (not automatic: a rewatch shouldn't check it off). Watching
 * past the first half minute marks it In progress on its tracks where it isn't done or marked already.
 */
export function TrackChips({ videoId, ended, watched, calendarName, onOpenTrack }: {
    videoId: string;
    /** How far into the video the reader has got this time, in seconds. */
    watched: number;
    /** Counts each time the video played to its end (0: not yet). A new count asks again. */
    ended: number;
    /** The Calendar section's name (the workspace may call it something else). */
    calendarName: string;
    onOpenTrack: (trackId: number) => void;
}) {
    const [placements, setPlacements] = useState<Placement[]>([]);
    const [busy, setBusy] = useState<number | null>(null);

    const load = useCallback(() => {
        listCalendarTracks()
            .then(tracks => setPlacements(tracks.flatMap(summary => summary.state.entries
                .map((entry, index) => ({ summary, entry, index }))
                .filter(p => p.entry.videoId === videoId))))
            .catch(() => setPlacements([]));
    }, [videoId]);
    useEffect(() => { setPlacements([]); load(); }, [load]);
    // Whether the "finished it?" line shows: from the video's end until it's answered.
    const [asking, setAsking] = useState(false);
    // Tracks unticked in it (with the video on more than one): left as they are.
    const [skipped, setSkipped] = useState<Set<number>>(new Set());
    useEffect(() => { setAsking(ended > 0); setSkipped(new Set()); }, [ended]);
    // Watched past the first half minute: In progress where it isn't done or marked yet, once per opening.
    const autoMarked = useRef<string | null>(null);
    useEffect(() => {
        if (watched < AUTO_PROGRESS_SECONDS || autoMarked.current === videoId || placements.length === 0) return;
        autoMarked.current = videoId;
        const toMark = placements.filter(p => !p.entry.done && !p.entry.inProgress);
        if (toMark.length === 0) return;
        void Promise.all(toMark.map(({ summary, entry }) =>
            setCalendarProgress(summary.track.id, entry, summary.state.cycle, true).catch(() => {}),
        )).then(load);
    }, [watched, videoId, placements]); // eslint-disable-line react-hooks/exhaustive-deps

    if (placements.length === 0) return null;

    const mark = async ({ summary, entry }: Placement) => {
        setBusy(summary.track.id);
        try {
            await setCalendarCompletion(summary.track.id, entry, summary.state.cycle, !entry.done);
        } catch { /* left as it was; the reload below shows that */ }
        setBusy(null);
        load();
    };
    const progress = async ({ summary, entry }: Placement) => {
        setBusy(summary.track.id);
        try {
            await setCalendarProgress(summary.track.id, entry, summary.state.cycle, !entry.inProgress);
        } catch { /* left as it was; the reload below shows that */ }
        setBusy(null);
        load();
    };

    // What the end-of-video prompt would mark: this video's places not yet done, less any unticked there.
    const toMark = placements.filter(p => !p.entry.done);
    const markAll = async () => {
        setAsking(false);
        for (const { summary, entry } of toMark.filter(p => !skipped.has(p.summary.track.id))) {
            try {
                await setCalendarCompletion(summary.track.id, entry, summary.state.cycle, true);
            } catch { /* left as it was; the reload below shows that */ }
        }
        load();
    };

    const prompt = asking && toMark.length > 0 && (
        <Modal
            onClose={() => setAsking(false)}
            icon={CircleCheck}
            title="Finished Watching"
            footer={
                <>
                    <SecondaryButton onClick={() => setAsking(false)}>Not Now</SecondaryButton>
                    <button
                        onClick={() => { void markAll(); }}
                        disabled={toMark.every(p => skipped.has(p.summary.track.id))}
                        className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Mark Done
                    </button>
                </>
            }
        >
            {toMark.length === 1 ? (
                <p className="text-[#aaaaaa] leading-relaxed">
                    Mark it done on <span className="text-white font-semibold">{toMark[0].summary.track.name}</span>?
                </p>
            ) : (
                <>
                    <p className="text-[#aaaaaa] leading-relaxed mb-3">It's on {toMark.length} tracks. Mark it done on:</p>
                    <div className="space-y-1">
                        {toMark.map(({ summary, entry }) => (
                            <label key={summary.track.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#1a1a1a] cursor-pointer text-sm text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={!skipped.has(summary.track.id)}
                                    onChange={() => setSkipped(prev => {
                                        const next = new Set(prev);
                                        if (next.has(summary.track.id)) next.delete(summary.track.id); else next.add(summary.track.id);
                                        return next;
                                    })}
                                    className="cursor-pointer"
                                />
                                <span className="min-w-0 truncate flex-1">{summary.track.name}</span>
                                <span className="text-xs text-[#888888] shrink-0">{entry.place} of {summary.state.total}</span>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );

    return (
        <div className="shrink-0 px-4 py-1.5 border-b border-[#303030] flex items-center gap-1.5 flex-wrap">
            {placements.map(p => {
                const { summary, entry, index } = p;
                const overdue = summary.state.current === index && summary.state.currentOverdue && !entry.done;
                const up = summary.state.current === index && !entry.done;
                return (
                    // The same chip as a video's tags (VideoTagsPanel): a box with its parts side by side.
                    <div key={`${summary.track.id}|${index}`} className="flex items-center bg-[#222222] border border-[#383838] rounded-md text-[11px] text-white">
                        <button
                            onClick={() => onOpenTrack(summary.track.id)}
                            title={`Open "${summary.track.name}" in ${calendarName}`}
                            className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 hover:text-[var(--k-accent)] transition-colors cursor-pointer"
                        >
                            <CalendarDays className="w-3 h-3 shrink-0 text-[#aaaaaa]" />
                            <span className="font-semibold truncate max-w-48">{summary.track.name}</span>
                            <span className="text-[#888888]">{p.entry.place} of {summary.state.total}</span>
                            {entry.dueDate && <span className={overdue ? 'text-red-400' : 'text-[#888888]'}>· {shortDate(entry.dueDate)}</span>}
                            {up && !entry.dueDate && <span className="text-[#888888]">· up next</span>}
                        </button>
                        {/* In progress (started, not finished): a marker only, lit in amber when on. Not once done. */}
                        {!entry.done && (
                            <button
                                onClick={() => { void progress(p); }}
                                disabled={busy === summary.track.id}
                                aria-pressed={entry.inProgress}
                                title={entry.inProgress ? 'In progress (click to clear)' : 'Mark in progress'}
                                className={`self-stretch flex items-center px-1.5 border-l border-[#383838] transition-colors cursor-pointer disabled:opacity-50 ${entry.inProgress ? 'text-amber-400' : 'text-[#888888] hover:text-white'}`}
                            >
                                <InProgressIcon className="w-3 h-3" />
                            </button>
                        )}
                        <button
                            onClick={() => { void mark(p); }}
                            disabled={busy === summary.track.id}
                            title={entry.done ? 'Mark not done' : 'Mark done'}
                            className={`self-stretch flex items-center gap-1 pl-1.5 pr-2 border-l border-[#383838] transition-colors cursor-pointer disabled:opacity-50 ${entry.done ? 'text-green-400 hover:text-gray-300' : 'text-[#aaaaaa] hover:text-white'}`}
                        >
                            <Check className="w-3 h-3" />
                            {entry.done ? 'Done' : 'Mark done'}
                        </button>
                    </div>
                );
            })}
            {prompt}
        </div>
    );
}
