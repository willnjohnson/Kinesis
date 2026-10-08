import { useEffect, useRef, useState } from 'react';
import { checkVideoIdentity } from '../../api';

/**
 * Each time a saved video is opened in the sidebar, YouTube is asked about it (by its ID, no API key; see
 * src-tauri/src/commands/orphans.rs): a renamed video takes its new title, and `renamed` holds the old and new for the
 * sidebar to say so; a video YouTube no longer has is marked orphaned (the Library's Orphaned window lists it) and
 * keeps its title. Nothing happens when YouTube can't be asked.
 */
export function useVideoIdentity({ videoId, saved, open, onTitleChanged }: {
    videoId?: string;
    /** Only a video in the library is checked. */
    saved: boolean;
    open: boolean;
    onTitleChanged?: (title: string) => void;
}) {
    const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(null);
    const [orphaned, setOrphaned] = useState<string | null>(null);
    // The video already asked about while the sidebar is open (cleared on close, so the next opening asks again).
    const checked = useRef<string | null>(null);
    const titleChanged = useRef(onTitleChanged);
    titleChanged.current = onTitleChanged;

    useEffect(() => {
        if (!open) { checked.current = null; setRenamed(null); setOrphaned(null); return; }
        if (!videoId || !saved || checked.current === videoId) return;
        checked.current = videoId;
        setRenamed(null);
        setOrphaned(null);
        checkVideoIdentity(videoId)
            .then(result => {
                if (checked.current !== videoId) return;
                if (result.status === 'orphaned') setOrphaned(result.reason ?? 'Video unavailable');
                if (result.oldTitle && result.newTitle) {
                    setRenamed({ from: result.oldTitle, to: result.newTitle });
                    titleChanged.current?.(result.newTitle);
                }
            })
            .catch(e => console.warn('Video check skipped:', e));
    }, [videoId, saved, open]);

    return { renamed, dismissRenamed: () => setRenamed(null), orphaned };
}
