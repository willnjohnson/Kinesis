import { useEffect, useState, useMemo, useCallback } from "react";
import { getUploadsPlaylistId, getVideos, getTranscript, getVideoInfo, saveVideo, searchVideos, getSavedVideos, deleteVideo, bulkSaveVideos, type Video } from "./api";
import { SearchBar } from "./components/SearchBar";
import { VideoList } from "./components/VideoList";
import { Sidebar } from "./components/Sidebar";
import KinesisLogo from "./assets/Kinesis.png";
import { Notification, type NotificationType } from "./components/Notification";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { BookOpen, Search, ChevronUp } from "lucide-react";

type ViewMode = 'search' | 'library';

function App() {
    // Search Mode State
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Library Mode State
    const [viewMode, setViewMode] = useState<ViewMode>('search');
    const [libraryVideos, setLibraryVideos] = useState<Video[]>([]);
    const [librarySearch, setLibrarySearch] = useState("");

    // Shared State
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [transcript, setTranscript] = useState("");
    const [loadingTranscript, setLoadingTranscript] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Pagination states (Search Only)
    const [continuationToken, setContinuationToken] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [currentSearch, setCurrentSearch] = useState<{ id: string, isPlaylist: boolean } | null>(null);

    // Bulk save state (Search Only)
    const [saveProgress, setSaveProgress] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Confirm dialog state
    const [confirmDelete, setConfirmDelete] = useState<{ video: Video, fromSidebar?: boolean } | null>(null);

    // Scroll to top state
    const [showScrollTop, setShowScrollTop] = useState(false);

    // Handle scroll visibility for "Back to Top" button
    useEffect(() => {
        const handleScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    };


    const refreshLibrary = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getSavedVideos();
            setLibraryVideos(res.videos);
        } catch (e: any) {
            setError("Failed to load library.");
            setNotification({ message: "Failed to load library", type: "error" });
        } finally {
            setLoading(false);
        }
    }, []);

    // Load saved videos when switching to Library mode
    useEffect(() => {
        setLibrarySearch(""); // Reset filter when switching
        if (viewMode === 'library') {
            refreshLibrary();
        }
    }, [viewMode, refreshLibrary]);


    const handleSearch = async (query: string) => {
        if (viewMode === 'library') {
            // In library mode, the search bar just filters locally
            setLibrarySearch(query);
            return;
        }

        setLoading(true);
        setError(null);
        setVideos([]);
        setSidebarOpen(false);
        setContinuationToken(null);
        setCurrentSearch(null);

        try {
            const playlistIdMatch = query.match(/[?&]list=([^#&?]+)/);
            const videoIdMatch = query.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
            const isPlaylistPattern = query.match(/^PL[a-zA-Z0-9_-]{16,}$/);

            // Check for various channel URL formats
            const channelUrlPattern = /(?:youtube\.com\/(?:c\/|channel\/|@|user\/))([^\/\s?]+)|(?:^@([^\/\s?]+))/i;
            const isChannel = channelUrlPattern.test(query) || query.startsWith('UC');

            if ((playlistIdMatch && playlistIdMatch[1]) || isPlaylistPattern) {
                // Playlist
                const playlistId = playlistIdMatch ? playlistIdMatch[1] : query;
                const res = await getVideos(playlistId, true);
                setVideos(res.videos);
                setContinuationToken(res.continuation);
                setCurrentSearch({ id: playlistId, isPlaylist: true });
                if (res.videos.length === 0) setError("No videos found in this playlist.");
            } else if (videoIdMatch && videoIdMatch[1]) {
                // Video
                const videoId = videoIdMatch[1];
                const videoInfo = await getVideoInfo(videoId);
                setVideos([videoInfo]);
                handleSelectVideo(videoInfo);
            } else if (isChannel) {
                // Channel
                const id = await getUploadsPlaylistId(query);
                const res = await getVideos(id, false);
                setVideos(res.videos);
                setContinuationToken(res.continuation);
                setCurrentSearch({ id, isPlaylist: false });
                if (res.videos.length === 0) setError("No videos found for this channel.");
            } else {
                // Search Query
                console.log("Searching for:", query);
                const res = await searchVideos(query);
                setVideos(res.videos);
                if (res.videos.length === 0) setError("No videos found for this search.");
            }

        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to fetch. Check your connection or the URL/handle.");
        } finally {
            setLoading(false);
        }
    };

    const handleLoadMore = async () => {
        if (!continuationToken || !currentSearch || loadingMore) return;

        setLoadingMore(true);
        try {
            const res = await getVideos(currentSearch.id, currentSearch.isPlaylist, continuationToken);

            setVideos(prev => {
                const existingIds = new Set(prev.map(v => v.id));
                const newUniqueVideos = res.videos.filter(v => !existingIds.has(v.id));
                return [...prev, ...newUniqueVideos];
            });

            setContinuationToken(res.continuation);
        } catch (e) {
            console.error("Failed to load more:", e);
        } finally {
            setLoadingMore(false);
        }
    };

    const handleSelectVideo = async (video: Video) => {
        setSelectedVideo(video);
        setSidebarOpen(true);
        setTranscript("");
        setLoadingTranscript(true);

        try {
            const text = await getTranscript(video.id);
            setTranscript(text);
        } catch (e) {
            setTranscript("Failed to load transcript.");
        } finally {
            setLoadingTranscript(false);
        }
    };

    const handleSaveVideo = async (video: Video) => {
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
    };

    const handleDeleteVideo = (video: Video) => {
        setConfirmDelete({ video, fromSidebar: false });
    };

    const handleDeleteFromSidebar = () => {
        if (selectedVideo) {
            setConfirmDelete({ video: selectedVideo, fromSidebar: true });
        }
    };

    const confirmDeleteAction = async () => {
        if (!confirmDelete) return;

        try {
            await deleteVideo(confirmDelete.video.id);
            setLibraryVideos(prev => prev.filter(v => v.id !== confirmDelete.video.id));
            setNotification({ message: `Deleted "${confirmDelete.video.title}"`, type: "success" });

            if (confirmDelete.fromSidebar) {
                setSidebarOpen(false);
                setSelectedVideo(null);
            }
        } catch (e: any) {
            setNotification({ message: `Failed to delete: ${e.message}`, type: "error" });
        } finally {
            setConfirmDelete(null);
        }
    };

    const handleSaveAll = async () => {
        if (videos.length === 0 || saveProgress) return;

        let allResults: any[] = [];
        const chunkSize = 10;

        try {
            for (let i = 0; i < videos.length; i += chunkSize) {
                const chunk = videos.slice(i, i + chunkSize);
                setSaveProgress(`Saving ${Math.min(i + chunk.length, videos.length)}/${videos.length}...`);

                const chunkIds = chunk.map(v => v.id);
                const results = await bulkSaveVideos(chunkIds);
                allResults.push(...results);
            }

            let savedCount = 0;
            let existedCount = 0;
            let errorCount = 0;

            allResults.forEach(res => {
                if (res.error) {
                    errorCount++;
                } else if (res.status === 'exists') {
                    existedCount++;
                } else {
                    savedCount++;
                }
            });

            setNotification({
                message: `Bulk save complete. Saved: ${savedCount}, Existed: ${existedCount}, Failed: ${errorCount}`,
                type: errorCount > 0 ? "info" : "success"
            });

            if (viewMode === 'library') refreshLibrary();
        } catch (e: any) {
            setNotification({ message: `Bulk save failed: ${e.message}`, type: "error" });
        } finally {
            setSaveProgress(null);
        }
    };



    // Filter library videos - memoized to prevent re-filtering on every render
    const filteredLibraryVideos = useMemo(() => {
        if (librarySearch === "") return libraryVideos;
        const searchLower = librarySearch.toLowerCase();
        return libraryVideos.filter(v =>
            v.title.toLowerCase().includes(searchLower) ||
            (v.author && v.author.toLowerCase().includes(searchLower))
        );
    }, [libraryVideos, librarySearch]);

    return (
        <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-red-500 selection:text-white pb-10 select-none">
            <div className="container mx-auto px-4 py-16">
                <header className="text-center mb-8 relative z-10 transition-all">
                    <div className="flex items-center justify-center gap-4 mb-4">
                        <img src={KinesisLogo} alt="Kinesis" className="w-12 h-12 md:w-14 md:h-14" />
                        <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white">
                            <span className="text-red-500">Kin</span>
                            <span className="text-white">esis</span>
                        </h1>
                    </div>

                    {/* View Toggle */}
                    <div className="flex justify-center mb-8">
                        <div className="bg-gray-900 p-1 rounded-lg border border-gray-800 flex gap-1">
                            <button
                                onClick={() => setViewMode('search')}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md transition-all font-bold text-sm cursor-pointer ${viewMode === 'search' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <Search className="w-4 h-4" />
                                Search
                            </button>
                            <button
                                onClick={() => setViewMode('library')}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md transition-all font-bold text-sm cursor-pointer ${viewMode === 'library' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <BookOpen className="w-4 h-4" />
                                Library
                            </button>
                        </div>
                    </div>
                </header>

                <SearchBar
                    key={viewMode}
                    onSearch={handleSearch}
                    loading={loading}
                    viewMode={viewMode}

                    placeholder={viewMode === 'library' ? "Search your bookmarks..." : "Search YouTube (URL, @handle, or query)..."}
                />


                {error && (
                    <div className="mt-8 text-center animate-in fade-in duration-300">
                        <div className="text-red-500 font-medium bg-red-500/10 p-4 rounded-lg border border-red-500/20 inline-block mx-auto">
                            {error}
                        </div>
                    </div>
                )}

                <div className="mt-16">
                    {/* Conditional Rendering based on ViewMode */}
                    {viewMode === 'search' ? (
                        <>
                            <VideoList
                                videos={videos}
                                onSelect={handleSelectVideo}
                                onSaveAll={videos.length > 0 ? handleSaveAll : undefined}
                                saveProgress={saveProgress}
                            />

                            {continuationToken && (
                                <div className="mt-12 text-center">
                                    <button
                                        onClick={handleLoadMore}
                                        disabled={loadingMore}
                                        className="px-8 py-3 bg-gray-900 border border-gray-800 rounded-lg text-sm font-bold uppercase tracking-widest hover:border-gray-600 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {loadingMore ? "Loading..." : "Load More"}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {libraryVideos.length === 0 && !loading ? (
                                <div className="text-center text-gray-500 py-12">
                                    <p className="text-lg">No saved transcripts found.</p>
                                    <p className="text-sm mt-2">Search videos and save them to build your library.</p>
                                </div>
                            ) : (
                                <VideoList
                                    videos={filteredLibraryVideos}
                                    onSelect={handleSelectVideo}
                                    onDelete={handleDeleteVideo}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            <Sidebar
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                transcript={transcript}
                loading={loadingTranscript}
                title={selectedVideo?.title || ""}
                videoId={selectedVideo?.id}
                onSave={selectedVideo ? () => handleSaveVideo(selectedVideo) : undefined}
                onDelete={handleDeleteFromSidebar}
            />

            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            {confirmDelete && (
                <ConfirmDialog
                    message={`Are you sure you want to delete "${confirmDelete.video.title}"?`}
                    onConfirm={confirmDeleteAction}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}

            {/* Back to Top Button */}
            <button
                onClick={scrollToTop}
                className={`fixed bottom-12 right-6 p-3 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg transition-all duration-300 cursor-pointer z-39 active:scale-95 ${showScrollTop
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4 pointer-events-none"
                    }`}
                title="Back to Top"
            >
                <ChevronUp className="w-6 h-6" />
            </button>
        </div>
    );
}

export default App;
