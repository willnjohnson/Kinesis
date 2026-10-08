import { useCallback, useEffect, useState } from 'react';
import {
    addVideoWdbsLink, decodeWdbs, encodeWdbs, getHandleDrives, getVideoWdbs, getVideoWdbsLinks, getWdbsAliases, getWdbsSuggestions,
    removeVideoWdbsLink, updateVideoWdbs,
} from '../../api';
import { useWorkspace } from '../../hooks/useWorkspace';

/**
 * The open video's Drives: its home ("primary") Drive and its "Also in" links, their aliases, and editing them (the
 * Drive editor, DriveEditor.tsx, opened from the sequence bar's pencil). Moved out of Sidebar.tsx as it was.
 */
export function useVideoDrives({ videoId, wdbs, existsInDb, handle, onWdbsUpdated, onWdbsChanged }: {
    videoId?: string;
    /** The video's Drive as the opener knew it (a Library video has it; one from Search doesn't). */
    wdbs?: string;
    existsInDb: boolean;
    handle?: string;
    onWdbsUpdated?: (encoded: string) => void;
    onWdbsChanged?: () => void;
}) {
    const { labels } = useWorkspace();
    const [isEditingWdbs, setIsEditingWdbs] = useState(false);
    const [wdbsInput, setWdbsInput] = useState('');
    const [wdbsError, setWdbsError] = useState<string | null>(null);
    const [savingWdbs, setSavingWdbs] = useState(false);
    const [wdbsSuggestions, setWdbsSuggestions] = useState<string[]>([]);
    // Drives this video's channel already appears in elsewhere (see DriveComboBox's Suggested
    // section) — refetched whenever the channel changes, not per-video, since it depends only on
    // the handle.
    const [channelSuggestedDrives, setChannelSuggestedDrives] = useState<string[]>([]);
    const [wdbsLinks, setWdbsLinks] = useState<string[]>([]);
    // Curated aliases of this video's Drive and "Also in" tags (storage path -> alias), shown as the
    // tags' tooltips. Only Drives that have one are in here.
    const [wdbsAliases, setWdbsAliases] = useState<Record<string, string>>({});
    // The video's actual canonical WDBS, looked up from the database rather than trusted from the
    // `wdbs` prop — a video opened from Search carries a freshly-fetched YouTube `Video` object
    // that never has `wdbs` set, even when that video is already saved locally with one (see
    // api.ts's getVideoWdbs). Falls back to the prop so a Library-opened video (which does carry
    // its real value already) renders immediately without waiting on the round trip.
    const [primaryWdbs, setPrimaryWdbs] = useState<string | undefined>(wdbs);
    const [isAddingLink, setIsAddingLink] = useState(false);
    const [linkInput, setLinkInput] = useState('');
    const [linkError, setLinkError] = useState<string | null>(null);
    const [savingLink, setSavingLink] = useState(false);

    // "Also in" (symlinks) only makes sense once there's a canonical WDBS to be "also" alongside
    // — see the "Also in" section of DriveEditor, and update_wdbs's own symlink cleanup when this becomes
    // false (clearing the canonical value removes any symlinks server-side too).
    const hasPrimaryWdbs = !!decodeWdbs(primaryWdbs);

    // Autocomplete suggestions (existing Warp Drive paths) are shared by the primary editor and
    // the "link to another Warp Drive" adder — loaded once, not per-video.
    useEffect(() => {
        getWdbsSuggestions().then(paths => setWdbsSuggestions(paths.map(decodeWdbs).filter(Boolean))).catch(() => {});
    }, []);

    // Suggested Drives for the combobox — every Drive this handle's other saved videos
    // already appear in (see the Suggested/Auto-Complete design this replaced the plain datalist
    // for). Depends only on the channel, so it's kept separate from the per-video reset effect below.
    useEffect(() => {
        if (!handle) { setChannelSuggestedDrives([]); return; }
        let cancelled = false;
        getHandleDrives(handle).then(drives => {
            if (!cancelled) setChannelSuggestedDrives(drives.map(d => d.display));
        }).catch(() => { if (!cancelled) setChannelSuggestedDrives([]); });
        return () => { cancelled = true; };
    }, [handle]);

    // Reset any in-progress WDBS edit whenever a different video is opened, so leftover input/
    // error state from one video's edit doesn't leak into the next one's panel. Symlinked Warp
    // Drives are re-fetched per video too, since they aren't part of the Video object itself.
    useEffect(() => {
        setIsEditingWdbs(false);
        setWdbsError(null);
        setIsAddingLink(false);
        setLinkInput('');
        setLinkError(null);
        setPrimaryWdbs(wdbs);
        setWdbsInput(decodeWdbs(wdbs));
        if (videoId && existsInDb) {
            getVideoWdbsLinks(videoId).then(setWdbsLinks).catch(() => setWdbsLinks([]));
            // The `wdbs` prop is only ever populated for a video opened from Library/Portal, whose
            // Video object comes straight from the database. One opened from Search comes fresh
            // from the YouTube API and never carries a `wdbs` value, even when that same video is
            // already saved locally with one — so once we know it's in the db, look up the real
            // value directly rather than keep showing "N/A" (see api.ts's getVideoWdbs).
            getVideoWdbs(videoId).then(v => {
                setPrimaryWdbs(v ?? undefined);
                setWdbsInput(decodeWdbs(v));
            }).catch(() => {});
        } else {
            setWdbsLinks([]);
        }
    }, [videoId, wdbs, existsInDb]);

    useEffect(() => {
        const paths = [primaryWdbs, ...wdbsLinks].filter((p): p is string => !!p && !!decodeWdbs(p));
        if (!existsInDb || paths.length === 0) {
            setWdbsAliases({});
            return;
        }
        let cancelled = false;
        getWdbsAliases(paths)
            .then(a => { if (!cancelled) setWdbsAliases(a); })
            .catch(() => { if (!cancelled) setWdbsAliases({}); });
        return () => { cancelled = true; };
    }, [existsInDb, primaryWdbs, wdbsLinks]);

    const handleSaveWdbs = useCallback(async () => {
        if (!videoId) return;
        setSavingWdbs(true);
        setWdbsError(null);
        try {
            await updateVideoWdbs(videoId, wdbsInput.trim());
            setIsEditingWdbs(false);
            const encoded = encodeWdbs(wdbsInput);
            setPrimaryWdbs(encoded);
            onWdbsUpdated?.(encoded);
            onWdbsChanged?.();
        } catch (e: any) {
            // update_wdbs already turns a SQLite trigger rejection into a plain-language message
            // (see commands::wdbs::update_wdbs) — surface it as-is.
            setWdbsError(typeof e === "string" ? e : e?.message ?? `Failed to update ${labels.aliasDriveLink}.`);
        } finally {
            setSavingWdbs(false);
        }
    }, [videoId, wdbsInput, onWdbsUpdated, onWdbsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleAddLink = useCallback(async () => {
        if (!videoId || !linkInput.trim()) return;
        setSavingLink(true);
        setLinkError(null);
        try {
            const encoded = await addVideoWdbsLink(videoId, linkInput.trim());
            setWdbsLinks(prev => prev.includes(encoded) ? prev : [...prev, encoded]);
            setLinkInput('');
            setIsAddingLink(false);
            onWdbsChanged?.();
        } catch (e: any) {
            setLinkError(typeof e === "string" ? e : e?.message ?? `Failed to ${labels.aliasDriveSymlink.toLowerCase()} ${labels.aliasDriveLink}.`);
        } finally {
            setSavingLink(false);
        }
    }, [videoId, linkInput, onWdbsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRemoveLink = useCallback(async (encoded: string) => {
        if (!videoId) return;
        // Optimistic: symlinks are low-stakes bookkeeping, and waiting on the round trip before
        // updating the chip list would make removal feel laggy for no real benefit.
        setWdbsLinks(prev => prev.filter(l => l !== encoded));
        try {
            await removeVideoWdbsLink(videoId, encoded);
            onWdbsChanged?.();
        } catch {
            setWdbsLinks(prev => prev.includes(encoded) ? prev : [...prev, encoded]);
        }
    }, [videoId, onWdbsChanged]);

    return {
        primaryWdbs, wdbsLinks, wdbsAliases, hasPrimaryWdbs, wdbsSuggestions, channelSuggestedDrives,
        isEditingWdbs, setIsEditingWdbs, wdbsInput, setWdbsInput, wdbsError, setWdbsError, savingWdbs,
        isAddingLink, setIsAddingLink, linkInput, setLinkInput, linkError, setLinkError, savingLink,
        handleSaveWdbs, handleAddLink, handleRemoveLink,
    };
}

export type VideoDrives = ReturnType<typeof useVideoDrives>;
