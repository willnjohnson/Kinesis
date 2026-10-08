import { useCallback, useState } from 'react';
import { addToDriveSequence, bulkUpdateVideoWdbs, type Video } from '../api';
import type { NotificationContent } from '../components/Notification';

/**
 * Bulk Assign in the Library: picking videos (click, Shift-click a range, drag a box) and filing the picked ones under a
 * Drive or adding them to a Drive's sequence, from the right-click menu (components/BulkAssignMenu).
 *
 * `displayedVideos` is the grid's order: a sequence gets the picked videos in that order (so sorting by date, then
 * picking a range, gives a chronological sequence), not the order they were clicked.
 */
export function useBulkAssign({ displayedVideos, library, sequenceName, notify, onFiled }: {
    displayedVideos: Video[];
    library: { sortField: string; sortOrder: string; refreshLibrary: () => void };
    /** The workspace's name for a sequence (the alias), for the messages. */
    sequenceName: string;
    notify: (n: NotificationContent) => void;
    /** After videos were filed somewhere else: the Drive tree's counts change. */
    onFiled: () => void;
}) {
    const [bulkAssignMode, setBulkAssignMode] = useState(false);
    const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
    const [bulkAssignMenu, setBulkAssignMenu] = useState<{ x: number; y: number; videoIds: string[] } | null>(null);
    const [bulkAssigning, setBulkAssigning] = useState(false);
    const [bulkAssignError, setBulkAssignError] = useState<string | null>(null);

    /** Out of Bulk Assign altogether: nothing picked, no menu (going somewhere else in the app). */
    const exitBulk = useCallback(() => {
        setBulkAssignMode(false);
        setBulkSelectedIds(new Set());
        setBulkAssignMenu(null);
    }, []);

    const handleToggleBulkSelect = useCallback((video: Video) => {
        setBulkSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
            return next;
        });
    }, []);

    // Shift-click range select/deselect — VideoList.tsx's handleBulkCardClick has already worked
    // out the full resulting selection (base-selection-before-the-anchor-click, with the anchor-
    // to-target range forced to match the anchor's own state), so this just applies it wholesale
    // rather than layering another add/remove on top.
    const handleBulkSelectRange = useCallback((nextSelectedIds: Set<string>) => {
        setBulkSelectedIds(nextSelectedIds);
    }, []);

    // Standard file-manager-style right-click: if the card is already part of the selection, the
    // menu applies to the whole selection; otherwise it applies to just this card (replacing
    // whatever was selected before), so a single video can be reassigned without a separate
    // select-then-right-click step.
    const handleBulkContextMenu = useCallback((video: Video, x: number, y: number) => {
        setBulkAssignError(null);
        setBulkSelectedIds(prev => {
            const targetIds = prev.has(video.id) ? Array.from(prev) : [video.id];
            setBulkAssignMenu({ x, y, videoIds: targetIds });
            return prev.has(video.id) ? prev : new Set([video.id]);
        });
    }, []);

    // The picked videos in the grid's order, and the sort a sequence should follow from it.
    const inGridOrder = (ids: string[]) => {
        const shown = new Map(displayedVideos.map((v, i) => [v.id, i]));
        return [...ids].sort((a, b) => (shown.get(a) ?? Infinity) - (shown.get(b) ?? Infinity));
    };
    const sequenceSort = () => ({
        sort: library.sortField === 'added' ? 'added' : library.sortField === 'popularity' ? 'views' : 'published',
        descending: library.sortOrder === 'desc',
    } as const);

    // `alsoSequence` (from BulkAssignMenu's checkbox) appends the same videos to that Drive's own
    // sequence right after assigning them — as a second step, once assignment has actually
    // succeeded, so add_to_drive_sequence's "filed at or beneath the Drive" check can never reject
    // them: they were just filed there, by this same action.
    const handleBulkAssign = useCallback(async (wdbs: string, alsoSequence: boolean) => {
        if (!bulkAssignMenu) return;
        setBulkAssigning(true);
        setBulkAssignError(null);
        try {
            const result = await bulkUpdateVideoWdbs(bulkAssignMenu.videoIds, wdbs);
            const label = wdbs.trim() || "unassigned";

            if (result.succeeded.length === 0 && result.failed.length > 0) {
                setBulkAssignError(result.failed[0][1]);
                return;
            }

            let seqAdded = 0;
            let seqAlreadyIn = 0;
            // Nothing to sequence into once the selection was cleared back to unassigned.
            if (alsoSequence && wdbs.trim() && result.succeeded.length > 0) {
                const seqOut = await addToDriveSequence(wdbs, inGridOrder(result.succeeded), sequenceSort());
                seqAdded = seqOut.added;
                seqAlreadyIn = seqOut.alreadyIn;
            }

            const assignPart = `Assigned ${result.succeeded.length} video${result.succeeded.length === 1 ? '' : 's'} to ${label}`;
            const failedPart = result.failed.length > 0 ? `; ${result.failed.length} failed` : '';
            const seqPart = alsoSequence && wdbs.trim()
                ? `, added ${seqAdded} to its ${sequenceName.toLowerCase()}${seqAlreadyIn > 0 ? ` (${seqAlreadyIn} already in it)` : ''}`
                : '';
            notify({ message: `${assignPart}${seqPart}${failedPart}.`, type: result.failed.length === 0 ? "success" : "info" });
            setBulkSelectedIds(new Set());
            setBulkAssignMenu(null);
            library.refreshLibrary();
            onFiled();
        } catch (e: any) {
            setBulkAssignError(typeof e === "string" ? e : e?.message ?? "Bulk assign failed.");
        } finally {
            setBulkAssigning(false);
        }
    }, [bulkAssignMenu, library, displayedVideos, notify, sequenceName, onFiled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Adds the selection to a Drive's sequence in the order the grid shows it.
    const handleBulkAddToSequence = useCallback(async (drive: string) => {
        if (!bulkAssignMenu) return;
        setBulkAssigning(true);
        setBulkAssignError(null);
        try {
            const out = await addToDriveSequence(drive, inGridOrder(bulkAssignMenu.videoIds), sequenceSort());
            const name = drive.trim().toUpperCase();
            const skipped = [
                out.alreadyIn > 0 ? `${out.alreadyIn} already in it` : '',
                out.notInDrive > 0 ? `${out.notInDrive} not filed under ${name}` : '',
            ].filter(Boolean).join(', ');
            if (out.added === 0) {
                setBulkAssignError(`Nothing added${skipped ? `: ${skipped}` : ''}.`);
            } else {
                notify({
                    message: `Added ${out.added} video${out.added === 1 ? '' : 's'} to the ${name} ${sequenceName.toLowerCase()}${skipped ? `; ${skipped}` : ''}.`,
                    type: skipped ? "info" : "success",
                });
                setBulkSelectedIds(new Set());
                setBulkAssignMenu(null);
            }
        } catch (e: any) {
            setBulkAssignError(typeof e === "string" ? e : e?.message ?? `Couldn't add to the ${sequenceName.toLowerCase()}.`);
        } finally {
            setBulkAssigning(false);
        }
    }, [bulkAssignMenu, displayedVideos, notify, sequenceName, library]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        bulkAssignMode, setBulkAssignMode, bulkSelectedIds, setBulkSelectedIds, bulkAssignMenu, setBulkAssignMenu,
        bulkAssigning, bulkAssignError, setBulkAssignError, exitBulk,
        handleToggleBulkSelect, handleBulkSelectRange, handleBulkContextMenu, handleBulkAssign, handleBulkAddToSequence,
    };
}
