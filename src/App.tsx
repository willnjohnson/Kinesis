import { useEffect, useState, useMemo, useCallback } from "react";
import { getVideos, getTranscript, getVideoInfo, saveVideo, searchVideos, getSavedVideos, deleteVideo, bulkSaveVideos, fetchChannelVideosV3, type Video } from "./api";
import { SearchBar, type Facet } from "./components/SearchBar";
import { VideoList } from "./components/VideoList";
import { Sidebar } from "./components/Sidebar";
import KinesisLogo from "./assets/Kinesis.png";
import { Notification, type NotificationType } from "./components/Notification";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsModal } from "./components/SettingsModal";
import { Settings, ChevronUp, ArrowDown } from "lucide-react";
import { getApiKey } from "./api";

type ViewMode = 'search' | 'library';

function App() {
    // Search Mode State
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter states for search results
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFacets, setActiveFacets] = useState<Facet[]>([]);
    const [activeText, setActiveText] = useState("");

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
    const [currentSearch, setCurrentSearch] = useState<{ id: string, isPlaylist: boolean, isV3Channel?: boolean } | null>(null);

    // Bulk save state (Search Only)
    const [saveProgress, setSaveProgress] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: NotificationType } | null>(null);

    // Confirm dialog state
    const [confirmDelete, setConfirmDelete] = useState<{ video: Video, fromSidebar?: boolean } | null>(null);

    // Scroll to top state
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);

    // Settings state
    const [showSettings, setShowSettings] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);

    useEffect(() => {
        getApiKey().then(k => setHasApiKey(!!k));
    }, []);

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

    const scrollToBottom = () => {
        window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'smooth'
        });
        setShowScrollBottom(false);
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
        if (viewMode === 'library') {
            refreshLibrary();
        }
    }, [viewMode, refreshLibrary]);


    const handleSearch = async (query: string) => {
        if (viewMode === 'library') {
            setLibrarySearch(query);
            return;
        }

        setLoading(true);
        setError(null);
        setVideos([]);
        setSidebarOpen(false);
        setContinuationToken(null);
        setCurrentSearch(null);
        setSearchQuery(query);

        try {
            // Improved facet parsing: matches type:value or type:"value with spaces"
            const facetRegex = /([a-z_]+):(?:"([^"]*)"|([^ ]*))/g;
            let match;
            let forcedType: 'handle' | 'playlist' | 'video' | null = null;
            let facetValue: string | null = null;
            let effectiveQuery = query;

            while ((match = facetRegex.exec(query)) !== null) {
                const type = match[1];
                const value = match[2] || match[3];
                if (type === 'handle') { forcedType = 'handle'; facetValue = value; }
                if (type === 'playlist') { forcedType = 'playlist'; facetValue = value; }
                if (type === 'video') { forcedType = 'video'; facetValue = value; }
                effectiveQuery = effectiveQuery.replace(match[0], '').trim();
            }

            // Fallback: If we have a forced type and effectiveQuery is empty, use the value from the badge
            const targetId = effectiveQuery || facetValue || "";

            const playlistIdMatch = targetId.match(/[?&]list=([^#&?]+)/);
            const videoIdMatch = targetId.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
            const isPlaylistId = /^(PL|UU|LL|RD|OLAK5uy_)[a-zA-Z0-9_-]+$/.test(targetId);

            const channelUrlPattern = /(?:youtube\.com\/(?:c\/|channel\/|@|user\/))([^\/\s?]+)|(?:^@([^\/\s?]+))/i;
            const isChannel = forcedType === 'handle' || channelUrlPattern.test(targetId) || targetId.startsWith('UC');
            const hasPlaylistId = (playlistIdMatch && playlistIdMatch[1]) || isPlaylistId;
            const hasVideoId = (videoIdMatch && videoIdMatch[1]);

            let mode: 'playlist' | 'video' | 'channel' | 'search' = 'search';
            if (forcedType) {
                if (forcedType === 'playlist') mode = 'playlist';
                else if (forcedType === 'video') mode = 'video';
                else if (forcedType === 'handle') mode = 'channel';
            } else if (hasVideoId) {
                mode = 'video';
            } else if (hasPlaylistId) {
                mode = 'playlist';
            } else if (isChannel) {
                mode = 'channel';
            }

            if (mode === 'playlist') {
                const playlistId = playlistIdMatch ? playlistIdMatch[1] : targetId.trim();
                const res = await getVideos(playlistId, true);
                const seen = new Set();
                const uniqueVideos = res.videos.filter(v => {
                    if (seen.has(v.id)) return false;
                    seen.add(v.id);
                    return true;
                });
                setVideos(uniqueVideos);
                setContinuationToken(res.continuation);
                setCurrentSearch({ id: playlistId, isPlaylist: true });
                if (uniqueVideos.length === 0) setError("No videos found in this playlist.");
            } else if (mode === 'video') {
                const videoId = videoIdMatch ? videoIdMatch[1] : (targetId.trim().length === 11 ? targetId.trim() : null);
                try {
                    if (!videoId) throw new Error("Invalid Video ID");
                    const videoInfo = await getVideoInfo(videoId);
                    setVideos([videoInfo]);
                    handleSelectVideo(videoInfo);
                    setCurrentSearch({ id: videoId, isPlaylist: false });
                } catch (err) {
                    setError("Video not found.");
                    setVideos([]);
                    setSidebarOpen(false);
                }
            } else if (mode === 'channel') {
                if (!hasApiKey) {
                    setError("You must import an API Key to search for channels.");
                    setVideos([]);
                } else {
                    const res = await fetchChannelVideosV3(targetId);
                    const seen = new Set();
                    const uniqueVideos = res.videos.filter(v => {
                        if (seen.has(v.id)) return false;
                        seen.add(v.id);
                        return true;
                    });
                    setVideos(uniqueVideos);
                    setContinuationToken(res.continuation);
                    setCurrentSearch({ id: targetId, isPlaylist: false, isV3Channel: true });
                    if (uniqueVideos.length === 0) setError("No videos found for this channel.");
                }
            } else {
                const res = await searchVideos(targetId);
                const seen = new Set();
                const uniqueVideos = res.videos.filter(v => {
                    if (seen.has(v.id)) return false;
                    seen.add(v.id);
                    return true;
                });
                setVideos(uniqueVideos);
                if (uniqueVideos.length === 0) setError("No videos found for this search.");
            }

            // After successful search, switch SearchBar to filter_search:
            setActiveFacets([{ type: 'filter_search', value: '' }]);
            setActiveText("");
            setSearchQuery("filter_search:");

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
            let res;
            if (currentSearch.isV3Channel) {
                res = await fetchChannelVideosV3(currentSearch.id, continuationToken);
            } else {
                res = await getVideos(currentSearch.id, currentSearch.isPlaylist, continuationToken);
            }

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

    const handleLoadAll = async () => {
        if (!continuationToken || !currentSearch || loadingMore) return;

        setLoadingMore(true);
        try {
            let token: string | null = continuationToken;
            while (token) {
                let res;
                if (currentSearch.isV3Channel) {
                    res = await fetchChannelVideosV3(currentSearch.id, token);
                } else {
                    res = await getVideos(currentSearch.id, currentSearch.isPlaylist, token);
                }

                setVideos(prev => {
                    const existingIds = new Set(prev.map(v => v.id));
                    const newUniqueVideos = res.videos.filter(v => !existingIds.has(v.id));
                    return [...prev, ...newUniqueVideos];
                });

                token = res.continuation;
                setContinuationToken(token || null);
                if (!token) break;
                // Optional: add a small delay to avoid rate limits
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) {
            console.error("Failed to load all:", e);
        } finally {
            setLoadingMore(false);
        }
    };

    const filteredVideos = useMemo(() => {
        const sourceVideos = viewMode === 'library' ? libraryVideos : videos;
        const queryToUse = (viewMode === 'library' ? librarySearch : searchQuery) || "";

        if (!queryToUse) return sourceVideos;

        const facetRegex = /([a-z_]+):(?:"([^"]*)"|([^ ]*))/g;
        const facets: { type: string, value: string }[] = [];
        let match;
        while ((match = facetRegex.exec(queryToUse)) !== null) {
            facets.push({
                type: match[1],
                value: match[2] || match[3] || ""
            });
        }

        const textTerms = queryToUse.replace(facetRegex, '').trim().toLowerCase().split(' ').filter(t => t);
        const filterBadge = facets.find(f => f.type === 'filter_search');

        // Only filter locally if filter_search badge is active
        if (!filterBadge) return sourceVideos;

        const badgeValue = filterBadge.value.toLowerCase();
        const badgeTerms = badgeValue.split(' ').filter(t => t);
        const allTerms = [...textTerms, ...badgeTerms];

        if (allTerms.length === 0) return sourceVideos;

        return sourceVideos.filter(v =>
            allTerms.every(term =>
                v.title.toLowerCase().includes(term) ||
                (v.author && v.author.toLowerCase().includes(term))
            )
        );
    }, [videos, libraryVideos, searchQuery, librarySearch, viewMode]);

    const handleSelectVideo = async (video: Video) => {
        setSelectedVideo(video);
        setSidebarOpen(true);
        setTranscript("");
        setLoadingTranscript(true);

        try {
            const text = await getTranscript(video.id);
            if (text === "API_KEY_MISSING") {
                setTranscript("No transcript available. API key missing.");
            } else {
                setTranscript(text);
            }
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
        if (filteredVideos.length === 0 || saveProgress) return;

        let allResults: any[] = [];
        const chunkSize = 10;

        try {
            for (let i = 0; i < filteredVideos.length; i += chunkSize) {
                const chunk = filteredVideos.slice(i, i + chunkSize);
                setSaveProgress(`Saving ${Math.min(i + chunk.length, filteredVideos.length)}/${filteredVideos.length}...`);

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



    return (
        <div className="min-h-screen bg-[#0f0f0f] text-white font-sans selection:bg-red-500/30 selection:text-white pb-20 select-none">
            <div className="container mx-auto px-4 pt-4">
                <header className="mb-10 relative z-10 transition-all">
                    <div className="flex items-center justify-between mb-12 relative max-w-7xl mx-auto border-b border-[#272727] pb-6">
                        <div className="flex items-center gap-3">
                            <img src={KinesisLogo} alt="Kinesis" className="w-8 h-8" />
                            <h1 className="text-2xl font-bold tracking-tighter text-white">
                                <span className="text-red-500">Kin</span>esis
                            </h1>
                        </div>

                        {/* View Toggle as Chips */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => setViewMode('search')}
                                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all cursor-pointer ${viewMode === 'search' ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                            >
                                Home
                            </button>
                            <button
                                onClick={() => setViewMode('library')}
                                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all cursor-pointer ${viewMode === 'library' ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                            >
                                Library
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2 ml-2 text-gray-400 hover:text-white transition-all cursor-pointer"
                                title="Settings"
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <SearchBar
                        key={viewMode}
                        onSearch={handleSearch}
                        onLiveFilter={setSearchQuery}
                        loading={loading}
                        viewMode={viewMode}
                        initialFacets={activeFacets}
                        initialQuery={activeText}
                        placeholder={viewMode === 'library' ? "Search your library" : "Search YouTube"}
                    />
                </header>

                {error && (
                    <div className="mt-8 text-center animate-in fade-in duration-300">
                        <div className="text-[#ff4e4e] font-medium bg-[#ff4e4e]/10 px-6 py-3 rounded-lg border border-[#ff4e4e]/20 inline-block mx-auto text-sm">
                            {error}
                        </div>
                    </div>
                )}

                <div className="mt-8">
                    {/* Conditional Rendering based on ViewMode */}
                    {viewMode === 'search' ? (
                        <>
                            <VideoList
                                videos={filteredVideos}
                                onSelect={handleSelectVideo}
                                onSaveAll={filteredVideos.length > 0 ? handleSaveAll : undefined}
                                saveProgress={saveProgress}
                            />

                            {continuationToken && (
                                <div className="mt-16 text-center flex justify-center gap-4">
                                    <button
                                        onClick={handleLoadMore}
                                        disabled={loadingMore}
                                        className="px-10 py-3 bg-[#272727] text-white rounded-full text-sm font-bold hover:bg-[#3f3f3f] transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {loadingMore ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                Loading...
                                            </div>
                                        ) : "Load More"}
                                    </button>
                                    <button
                                        onClick={handleLoadAll}
                                        disabled={loadingMore}
                                        className="px-10 py-3 bg-white text-black rounded-full text-sm font-bold hover:bg-[#e5e5e5] transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {loadingMore ? "Loading..." : "Load All"}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400">
                            {libraryVideos.length === 0 && !loading ? (
                                <div className="text-center text-gray-500 py-24">
                                    <p className="text-xl font-bold text-white mb-2">Build your library</p>
                                    <p className="text-sm">Find videos you love and save their transcripts here.</p>
                                </div>
                            ) : (
                                <VideoList
                                    videos={filteredVideos}
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
                onRefetch={selectedVideo ? () => handleSelectVideo(selectedVideo) : undefined}
                hasApiKey={hasApiKey}
            />

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                onStatusChange={setHasApiKey}
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
                className={`fixed bottom-12 right-6 p-3 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg transition-opacity duration-200 cursor-pointer z-39 active:scale-95 ${showScrollTop
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                    }`}
                title="Back to Top"
            >
                <ChevronUp className="w-6 h-6" />
            </button>

            {/* Scroll to Bottom (Post-Load Hint) */}
            <button
                onClick={scrollToBottom}
                className={`fixed bottom-12 left-6 px-4 py-3 bg-[#121212] border border-[#303030] hover:bg-[#222222] hover:border-[#505050] text-[#aaaaaa] hover:text-white rounded-lg shadow-xl transition-all duration-200 cursor-pointer z-39 flex items-center gap-3 active:scale-95 ${showScrollBottom
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                    }`}
            >
                <ArrowDown className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest">Scroll to Bottom</span>
            </button>
        </div>
    );
}

export default App;
