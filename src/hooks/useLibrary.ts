import { useState, useCallback } from "react";
import {
    getSavedVideos, saveVideo, deleteVideo, bulkSaveVideos,
    summarizeAllVideos, getSummarizedCount,
    type Video
} from "../api";
import { type NotificationType } from "../components/Notification";

type ViewMode = 'search' | 'library';

export function useLibrary(
    viewMode: ViewMode,
    pluginSummarizeEnabled: boolean,
    filteredSearchVideos: Video[],
    setNotification: (n: { message: string; type: NotificationType } | null) => void,
) {
    const [libraryVideos, setLibraryVideos] = useState<Video[]>([]);
    const [librarySearch, setLibrarySearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [saveProgress, setSaveProgress] = useState<string | null>(null);
    const [summarizeProgress, setSummarizeProgress] = useState<string | null>(null);
    const [summarizedCount, setSummarizedCount] = useState(0);
    const [confirmDelete, setConfirmDelete] = useState<{ video: Video; fromSidebar?: boolean } | null>(null);

    const refreshSummarizedCount = useCallback(async () => {
        if (!pluginSummarizeEnabled) return;
        try { setSummarizedCount(await getSummarizedCount()); } catch { /* ignore */ }
    }, [pluginSummarizeEnabled]);

    const refreshLibrary = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getSavedVideos();
            setLibraryVideos(res.videos);
            if (pluginSummarizeEnabled) refreshSummarizedCount();
        } catch {
            setNotification({ message: "Failed to load library", type: "error" });
        } finally {
            setLoading(false);
        }
    }, [pluginSummarizeEnabled, refreshSummarizedCount, setNotification]);

    const handleSaveVideo = useCallback(async (video: Video) => {
        if (!video) return;
        try {
            const result = await saveVideo(video.id);
            if (result.status === 'exists') {
                setNotification({ message: `"${video.title.substring(0, 30)}..." already exists in DB.`, type: "info" });
            } else {
                setNotification({ message: `Saved "${video.title.substring(0, 30)}..." to library.`, type: "success" });
                if (viewMode === 'library') refreshLibrary();
            }
        } catch (e: any) {
            setNotification({ message: `Failed to save: ${e.message}`, type: "error" });
        }
    }, [viewMode, refreshLibrary, setNotification]);

    const handleDeleteVideo = useCallback((video: Video) => {
        setConfirmDelete({ video, fromSidebar: false });
    }, []);

    const handleDeleteFromSidebar = useCallback((video: Video | null) => {
        if (video) setConfirmDelete({ video, fromSidebar: true });
    }, []);

    const confirmDeleteAction = useCallback(async (
        onSidebarClose: () => void,
    ) => {
        if (!confirmDelete) return;
        try {
            await deleteVideo(confirmDelete.video.id);
            setLibraryVideos(prev => prev.filter(v => v.id !== confirmDelete.video.id));
            setNotification({ message: `Deleted "${confirmDelete.video.title}"`, type: "success" });
            if (confirmDelete.fromSidebar) onSidebarClose();
        } catch (e: any) {
            setNotification({ message: `Failed to delete: ${e.message}`, type: "error" });
        } finally {
            setConfirmDelete(null);
            refreshSummarizedCount();
        }
    }, [confirmDelete, refreshSummarizedCount, setNotification]);

    const handleSaveAll = useCallback(async () => {
        if (filteredSearchVideos.length === 0 || saveProgress) return;
        const chunkSize = 10;
        let allResults: any[] = [];
        try {
            for (let i = 0; i < filteredSearchVideos.length; i += chunkSize) {
                const chunk = filteredSearchVideos.slice(i, i + chunkSize);
                setSaveProgress(`Saving ${Math.min(i + chunk.length, filteredSearchVideos.length)}/${filteredSearchVideos.length}...`);
                const results = await bulkSaveVideos(chunk.map(v => v.id));
                allResults.push(...results);
            }
            let saved = 0, existed = 0, errored = 0;
            allResults.forEach(r => { if (r.error) errored++; else if (r.status === 'exists') existed++; else saved++; });
            setNotification({
                message: `Bulk save complete. Saved: ${saved}, Existed: ${existed}, Failed: ${errored}`,
                type: errored > 0 ? "info" : "success"
            });
            if (viewMode === 'library') refreshLibrary();
        } catch (e: any) {
            setNotification({ message: `Bulk save failed: ${e.message}`, type: "error" });
        } finally {
            setSaveProgress(null);
        }
    }, [filteredSearchVideos, saveProgress, viewMode, refreshLibrary, setNotification]);

    const handleSummarizeAll = useCallback(async () => {
        if (summarizeProgress || !pluginSummarizeEnabled) return;
        if (libraryVideos.length === 0) {
            setNotification({ message: "No videos in library to summarize", type: "info" });
            return;
        }
        try {
            setSummarizeProgress("Starting...");
            const count = await summarizeAllVideos();
            setSummarizedCount(prev => prev + count);
            setNotification({
                message: count > 0 ? `Successfully summarized ${count} video${count > 1 ? 's' : ''}` : "All videos are already summarized",
                type: count > 0 ? "success" : "info"
            });
        } catch (e: any) {
            setNotification({ message: `Summarize failed: ${e.message}`, type: "error" });
        } finally {
            setSummarizeProgress(null);
        }
    }, [summarizeProgress, pluginSummarizeEnabled, libraryVideos.length, setNotification]);

    return {
        libraryVideos,
        librarySearch,
        setLibrarySearch,
        loading,
        saveProgress,
        summarizeProgress,
        summarizedCount,
        confirmDelete,
        setConfirmDelete,
        refreshLibrary,
        refreshSummarizedCount,
        handleSaveVideo,
        handleDeleteVideo,
        handleDeleteFromSidebar,
        confirmDeleteAction,
        handleSaveAll,
        handleSummarizeAll,
    };
}
