import { useEffect, useState, useCallback } from "react";
import {
    getTranscript, getDisplaySettings, setDisplaySettings,
    getApiKey, getSetting, setDbPath,
    type Video
} from "./api";
import { SearchBar, type Facet } from "./components/SearchBar";
import { VideoList } from "./components/VideoList";
import { Sidebar } from "./components/Sidebar";
import { BRAND } from "./branding";
import { Notification, type NotificationType } from "./components/Notification";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsModal } from "./components/SettingsModal";
import { Settings, ChevronUp, LayoutGrid, List } from "lucide-react";
import { useSearch } from "./hooks/useSearch";
import { useLibrary } from "./hooks/useLibrary";

type ViewMode = 'search' | 'library';

function App() {
    // ── App-level state ─────────────────────────────────────────────────────
    const [viewMode, setViewMode] = useState<ViewMode>('search');
    const [notification, setNotification] = useState<{ message: string; type: NotificationType } | null>(null);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [videoListMode, setVideoListMode] = useState<'grid' | 'compact'>('grid');
    const [pluginSummarizeEnabled, setPluginSummarizeEnabled] = useState(false);

    // ── Sidebar / transcript state ───────────────────────────────────────────
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [transcript, setTranscript] = useState("");
    const [loadingTranscript, setLoadingTranscript] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // ── Hooks ────────────────────────────────────────────────────────────────
    const search = useSearch(hasApiKey);

    const library = useLibrary(
        viewMode,
        pluginSummarizeEnabled,
        search.filteredVideos,
        setNotification,
    );

    // ── Computed: which videos to show in VideoList ──────────────────────────
    const displayedVideos = (() => {
        if (viewMode === 'library') {
            const q = library.librarySearch;
            if (!q) return library.libraryVideos;

            // Parse facets — the SearchBar always emits a filter_search: badge in library mode.
            // When that badge has no value (initial state), we must return all videos, not zero.
            const FACET_RE = /([a-z_]+):(?:"([^"]*)"|([^ ]*))/g;
            const facets: { type: string; value: string }[] = [];
            let m;
            while ((m = FACET_RE.exec(q)) !== null) {
                facets.push({ type: m[1], value: m[2] ?? m[3] ?? "" });
            }
            const filterBadge = facets.find(f => f.type === 'filter_search');
            if (!filterBadge) return library.libraryVideos;

            const textTerms = q.replace(/([a-z_]+):(?:"([^"]*)"|([^ ]*))/g, '').trim().toLowerCase().split(' ').filter(Boolean);
            const badgeTerms = filterBadge.value.toLowerCase().split(' ').filter(Boolean);
            const allTerms = [...textTerms, ...badgeTerms];
            if (allTerms.length === 0) return library.libraryVideos; // empty filter → show all

            return library.libraryVideos.filter(v =>
                allTerms.every(term =>
                    v.title.toLowerCase().includes(term) ||
                    (v.author && v.author.toLowerCase().includes(term))
                )
            );
        }
        return search.filteredVideos;
    })();

    // ── Init ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        const initialize = async () => {
            const savedPath = localStorage.getItem(BRAND.storageKey);
            if (savedPath) {
                const folderPath = savedPath.endsWith(BRAND.dbName)
                    ? savedPath.substring(0, savedPath.lastIndexOf(savedPath.includes('\\') ? '\\' : '/'))
                    : savedPath;
                try { await setDbPath(folderPath); } catch { /* ignore */ }
            }
            getApiKey().then(k => setHasApiKey(!!k));
            getSetting('plugin_summarize_enabled').then(v => setPluginSummarizeEnabled(v === 'true'));
        };
        initialize();
    }, []);

    // ── Theme / display settings ─────────────────────────────────────────────
    useEffect(() => {
        getDisplaySettings().then(settings => {
            document.documentElement.classList.toggle('dark', settings.theme === 'dark');
            setVideoListMode((settings.videoListMode as 'grid' | 'compact') || 'grid');
        }).catch(() => document.documentElement.classList.add('dark'));
    }, []);

    // ── Scroll-to-top ────────────────────────────────────────────────────────
    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    // ── Load library when switching to Library mode ──────────────────────────
    useEffect(() => {
        if (viewMode === 'library') {
            library.refreshLibrary();
        }
    }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Refresh summarized count when entering Library (if plugin on) ─────────
    useEffect(() => {
        if (viewMode === 'library' && pluginSummarizeEnabled) {
            library.refreshSummarizedCount();
        }
    }, [viewMode, pluginSummarizeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleSelectVideo = useCallback(async (video: Video) => {
        setSelectedVideo(video);
        setSidebarOpen(true);
        setTranscript("");
        setLoadingTranscript(true);
        try {
            const text = await getTranscript(video.id);
            setTranscript(text === "API_KEY_MISSING" ? "No transcript available. API key missing." : text);
        } catch (e: any) {
            setTranscript(`Failed to load transcript: ${e.message || String(e)}`);
        } finally {
            setLoadingTranscript(false);
        }
    }, []);

    const handleSearch = useCallback(async (query: string) => {
        if (viewMode === 'library') {
            library.setLibrarySearch(query);
            return;
        }
        setSidebarOpen(false);
        const videoResult = await search.handleSearch(query);
        if (videoResult) handleSelectVideo(videoResult);
    }, [viewMode, library, search, handleSelectVideo]);

    const toggleVideoListMode = async () => {
        const newMode = videoListMode === 'grid' ? 'compact' : 'grid';
        setVideoListMode(newMode);
        try {
            const current = await getDisplaySettings();
            await setDisplaySettings({ ...current, videoListMode: newMode });
        } catch { /* ignore */ }
    };

    return (
        <div className="min-h-screen bg-[#0f0f0f] text-white font-sans selection:bg-red-500/30 selection:text-white pb-20 select-none">
            <div className="container mx-auto px-4 pt-4">
                <header className="mb-10 relative z-10 transition-all">
                    {/* Top bar */}
                    <div className="flex items-center justify-between mb-12 relative max-w-7xl mx-auto border-b border-[#272727] pb-6">
                        <div className="flex items-center gap-3">
                            <img src={BRAND.logo} alt={BRAND.name} className="w-8 h-8" />
                            <div className="flex flex-col">
                                <h1 className="text-2xl font-bold tracking-tighter text-white">
                                    <span className="text-red-500">{BRAND.name.substring(0, 3)}</span>{BRAND.name.substring(3)}
                                </h1>
                                <span className="text-xs text-gray-500 -mt-0.5">{BRAND.tagline}</span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            {(['search', 'library'] as ViewMode[]).map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => setViewMode(mode)}
                                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all cursor-pointer capitalize ${viewMode === mode ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                                >
                                    {mode}
                                </button>
                            ))}
                            <button
                                onClick={toggleVideoListMode}
                                className="p-2 ml-2 text-gray-400 hover:text-white transition-all cursor-pointer bg-[#272727] rounded-lg"
                                title={videoListMode === 'grid' ? "Switch to Compact View" : "Switch to Grid View"}
                            >
                                {videoListMode === 'grid' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2 ml-1 text-gray-400 hover:text-white transition-all cursor-pointer"
                                title="Settings"
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <SearchBar
                        key={viewMode}
                        onSearch={handleSearch}
                        onLiveFilter={viewMode === 'search' ? search.setSearchQuery : undefined}
                        loading={search.loading || library.loading}
                        viewMode={viewMode}
                        initialFacets={search.activeFacets as Facet[]}
                        initialQuery={search.activeText}
                        placeholder={viewMode === 'library' ? "Search your library" : "Search YouTube"}
                    />
                </header>

                {search.error && (
                    <div className="mt-8 text-center animate-in fade-in duration-300">
                        <div className="text-[#ff4e4e] font-medium bg-[#ff4e4e]/10 px-6 py-3 rounded-lg border border-[#ff4e4e]/20 inline-block mx-auto text-sm">
                            {search.error}
                        </div>
                    </div>
                )}

                <div className="mt-8">
                    {viewMode === 'search' ? (
                        <>
                            <VideoList
                                videos={displayedVideos}
                                onSelect={handleSelectVideo}
                                onSaveAll={displayedVideos.length > 0 ? library.handleSaveAll : undefined}
                                saveProgress={library.saveProgress}
                                compact={videoListMode === 'compact'}
                            />
                            {search.continuationToken && (
                                <div className="mt-16 text-center flex justify-center gap-4">
                                    <button
                                        onClick={search.handleLoadMore}
                                        disabled={search.loadingMore}
                                        className="px-10 py-3 bg-[#272727] text-white rounded-full text-sm font-bold hover:bg-[#3f3f3f] transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {search.loadingMore
                                            ? <div className="flex items-center gap-2"><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Loading...</div>
                                            : "Load More"
                                        }
                                    </button>
                                    <button
                                        onClick={search.handleLoadAll}
                                        disabled={search.loadingMore}
                                        className="px-10 py-3 bg-white text-black rounded-full text-sm font-bold hover:bg-[#e5e5e5] transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {search.loadingMore ? "Loading..." : "Load All"}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-400">
                            {library.libraryVideos.length === 0 && !library.loading ? (
                                <div className="text-center text-gray-500 py-24">
                                    <p className="text-xl font-bold text-white mb-2">Build your library</p>
                                    <p className="text-sm">Find videos and save their transcripts here.</p>
                                </div>
                            ) : (
                                <VideoList
                                    videos={displayedVideos}
                                    onSelect={handleSelectVideo}
                                    onDelete={library.handleDeleteVideo}
                                    compact={videoListMode === 'compact'}
                                    onSummarizeAll={library.handleSummarizeAll}
                                    summarizeProgress={library.summarizeProgress}
                                    summarizedCount={library.summarizedCount}
                                    totalCount={library.libraryVideos.length}
                                    isLibrary={true}
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
                onSave={selectedVideo ? () => library.handleSaveVideo(selectedVideo) : undefined}
                onDelete={() => library.handleDeleteFromSidebar(selectedVideo)}
                onRefetch={selectedVideo ? () => handleSelectVideo(selectedVideo) : undefined}
                hasApiKey={hasApiKey}
                pluginSummarizeEnabled={pluginSummarizeEnabled}
                onSummaryGenerated={library.refreshSummarizedCount}
            />

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                onStatusChange={setHasApiKey}
                onVideoListModeChange={setVideoListMode}
                currentVideoListMode={videoListMode}
                onPluginsChange={() => getSetting('plugin_summarize_enabled').then(v => setPluginSummarizeEnabled(v === 'true'))}
            />

            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            {library.confirmDelete && (
                <ConfirmDialog
                    message={`Are you sure you want to delete "${library.confirmDelete.video.title}"?`}
                    onConfirm={() => library.confirmDeleteAction(() => { setSidebarOpen(false); setSelectedVideo(null); })}
                    onCancel={() => library.setConfirmDelete(null)}
                />
            )}

            <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className={`fixed bottom-12 right-6 p-3 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg transition-opacity duration-200 cursor-pointer z-39 active:scale-95 ${showScrollTop ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                title="Back to Top"
            >
                <ChevronUp className="w-6 h-6" style={{ color: '#ffffff' }} />
            </button>
        </div>
    );
}

export default App;
