import { useState, useEffect } from "react";
import { getUploadsPlaylistId, getVideos, getTranscript, getVideoInfo, checkApiKey, type Video } from "./api";
import { SearchBar } from "./components/SearchBar";
import { VideoList } from "./components/VideoList";
import { Sidebar } from "./components/Sidebar";
import { KeySetup } from "./components/KeySetup";
import KinesisLogo from "./assets/Kinesis.png";

function App() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [transcript, setTranscript] = useState("");
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Pagination states
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentSearch, setCurrentSearch] = useState<{ id: string, isPlaylist: boolean } | null>(null);

  useEffect(() => {
    checkApiKey().then(setHasKey);
  }, []);

  useEffect(() => {
    const handleVideoUpdate = (event: any) => {
      const { videoId, viewCount } = event.detail;
      setVideos(prevVideos =>
        prevVideos.map(v =>
          v.id === videoId ? { ...v, viewCount } : v
        )
      );
    };

    window.addEventListener('video-updated', handleVideoUpdate);
    return () => window.removeEventListener('video-updated', handleVideoUpdate);
  }, []);

  if (hasKey === null) return <div className="min-h-screen bg-gray-950" />;
  if (hasKey === false) return <KeySetup onComplete={() => setHasKey(true)} />;

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setVideos([]);
    setSidebarOpen(false);
    setContinuationToken(null);
    setCurrentSearch(null);

    try {
      const playlistIdMatch = query.match(/[?&]list=([^#&?]+)/);
      const videoIdMatch = query.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);

      if (playlistIdMatch && playlistIdMatch[1]) {
        const playlistId = playlistIdMatch[1];
        const res = await getVideos(playlistId, true);
        setVideos(res.videos);
        setContinuationToken(res.continuation);
        setCurrentSearch({ id: playlistId, isPlaylist: true });
        if (res.videos.length === 0) setError("No videos found in this playlist.");
      } else if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1];
        const videoInfo = await getVideoInfo(videoId);
        setVideos([videoInfo]);
        handleSelectVideo(videoInfo);
      } else {
        const id = await getUploadsPlaylistId(query);
        const res = await getVideos(id, false);
        setVideos(res.videos);
        setContinuationToken(res.continuation);
        setCurrentSearch({ id, isPlaylist: false });
        if (res.videos.length === 0) setError("No videos found for this channel.");
      }
    } catch (e: any) {
      setError(e.message || "Failed to fetch. Check your connection.");
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

    const text = await getTranscript(video.id);
    setTranscript(text);
    setLoadingTranscript(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-red-500 selection:text-white pb-10 select-none">
      <div className="container mx-auto px-4 py-16">
        <header className="text-center mb-16 relative z-10 transition-all">
          <div className="flex items-center justify-center gap-4 mb-4">
            <img src={KinesisLogo} alt="Kinesis" className="w-12 h-12 md:w-14 md:h-14" />
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white">
              <span className="text-red-500">Kin</span>
              <span className="text-white-500">esis</span>
            </h1>
          </div>
          <p className="text-gray-400 text-md max-w-md mx-auto leading-relaxed font-medium">
            Explore video transcripts seamlessly.
          </p>
        </header>

        <SearchBar onSearch={handleSearch} loading={loading} />

        {error && (
          <div className="mt-8 text-center animate-in fade-in duration-300">
            <div className="text-red-500 font-medium bg-red-500/10 p-4 rounded-lg border border-red-500/20 inline-block mx-auto">
              {error}
            </div>
          </div>
        )}

        <div className="mt-16">
          <VideoList videos={videos} onSelect={handleSelectVideo} />

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
        </div>
      </div>

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        transcript={transcript}
        loading={loadingTranscript}
        title={selectedVideo?.title || ""}
      />
    </div>
  );
}

export default App;
