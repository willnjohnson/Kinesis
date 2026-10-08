import { useEffect, useRef, useState, type RefObject } from 'react';
import { getVideoPosition, setVideoPosition, setVideoWatched } from '../../api';

/** Positions within this much of either end aren't worth offering to resume (it's the start, or it's all but over). */
const EDGE_SECONDS = 15;
/** How often a playing video's position is written while it plays (the embed page reports every few seconds). */
const SAVE_EVERY_MS = 10_000;

/**
 * Where the reader stopped in a saved video, kept so opening it again can offer "Resume from 23:14". The embed page
 * (src-tauri/src/http_server.rs) reports the position while the video plays and on a pause; it's written every few
 * seconds and once more when the video changes or the sidebar closes. Playing to the end forgets it. Not offered when the
 * video was opened at a moment of its own (a timed link), or near either end.
 *
 * Also says how far into this video the reader got this time (`watched`), for the track chips' automatic In progress.
 */
export function useResumePosition({ videoId, saved, open, startAt, ended, playerRef }: {
    videoId?: string;
    /** Only a video in the library has a position kept. */
    saved: boolean;
    open: boolean;
    startAt?: number;
    /** Counts each time the video played to its end. */
    ended: number;
    playerRef: RefObject<HTMLIFrameElement | null>;
}) {
    const [resumeAt, setResumeAt] = useState<number | null>(null);
    const [watched, setWatched] = useState(0);
    // The latest report, and when one was last written.
    const last = useRef<{ seconds: number; duration: number | null } | null>(null);
    const writtenAt = useRef(0);
    const current = useRef<string | undefined>(undefined);

    const flush = (id: string | undefined) => {
        const p = last.current;
        if (!id || !p) return;
        last.current = null;
        void setVideoPosition(id, p.seconds, p.duration).catch(() => {});
    };

    // A new video (or the sidebar closing): what was being watched is written, and the new one's position looked up.
    useEffect(() => {
        flush(current.current);
        current.current = open && saved ? videoId : undefined;
        setResumeAt(null);
        setWatched(0);
        writtenAt.current = 0;
        if (!videoId || !open || !saved || startAt) return;
        let live = true;
        getVideoPosition(videoId)
            .then(p => {
                if (!live || !p) return;
                const nearEnd = p.duration !== null && p.seconds > p.duration - EDGE_SECONDS;
                if (p.seconds >= EDGE_SECONDS && !nearEnd) setResumeAt(p.seconds);
            })
            .catch(() => {});
        return () => { live = false; };
    }, [videoId, open, saved]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closing the app or the window with a video open still writes where it was.
    useEffect(() => {
        const out = () => flush(current.current);
        window.addEventListener('beforeunload', out);
        return () => { window.removeEventListener('beforeunload', out); out(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // The embed page's reports.
    useEffect(() => {
        const onReport = (e: MessageEvent) => {
            if (e.data?.type !== 'kinesis-progress' || !playerRef.current || e.source !== playerRef.current.contentWindow) return;
            const seconds = Number(e.data.seconds);
            if (!Number.isFinite(seconds) || !current.current) return;
            const duration = typeof e.data.duration === 'number' && e.data.duration > 0 ? e.data.duration : null;
            last.current = { seconds, duration };
            setWatched(w => Math.max(w, seconds));
            // Watching from somewhere else: the offer has served its turn.
            if (seconds > EDGE_SECONDS) setResumeAt(null);
            if (Date.now() - writtenAt.current >= SAVE_EVERY_MS) {
                writtenAt.current = Date.now();
                flush(current.current);
            }
        };
        window.addEventListener('message', onReport);
        return () => window.removeEventListener('message', onReport);
    }, [playerRef]);

    // Played to the end: watched (the pin menu's Watched list), with nothing left to resume.
    useEffect(() => {
        if (ended === 0 || !current.current) return;
        last.current = null;
        setResumeAt(null);
        void setVideoWatched(current.current, true).catch(() => {});
    }, [ended]);

    return { resumeAt, dismissResume: () => setResumeAt(null), watched };
}
