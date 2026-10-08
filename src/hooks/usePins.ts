import { useCallback, useEffect, useState } from 'react';
import { listPins, setPinned } from '../api';
import type { NotificationContent } from '../components/Notification';

/**
 * Which videos are pinned (db/pins.rs), for the sidebar's pin button, and pinning or unpinning the open one. The title
 * bar's pin menu (components/PinsMenu.tsx) keeps its own list and calls `refreshPins` after changing pins there.
 */
export function usePins(selectedVideoId: string | null, notify: (n: NotificationContent) => void) {
    const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
    const refreshPins = useCallback(() => {
        listPins().then(list => setPinnedIds(new Set(list.map(v => v.videoId)))).catch(() => {});
    }, []);
    useEffect(() => { refreshPins(); }, [refreshPins]);

    /** Pins or unpins a video (the Calendar's item menu, say). Pinning one not in the library says why it can't. */
    const setPin = async (videoId: string, pinned: boolean) => {
        try {
            await setPinned(videoId, pinned);
        } catch (e) {
            notify({ message: String(e), type: 'error' });
        }
        refreshPins();
    };

    /** The open video: pinned if it wasn't, unpinned if it was. */
    const togglePin = async () => {
        if (!selectedVideoId) return;
        await setPin(selectedVideoId, !pinnedIds.has(selectedVideoId));
    };

    return { pinnedIds, refreshPins, togglePin, setPin };
}
