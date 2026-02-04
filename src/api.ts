import { invoke } from '@tauri-apps/api/core';

export interface Video {
    id: string;
    title: string;
    thumbnail: string;
    publishedAt: string;
    viewCount: string;
}

interface ChannelInfo {
    channelId: string;
    channelName: string;
}

export interface VideoResponse {
    videos: Video[];
    continuation: string | null;
}

/**
 * Resolve a YouTube handle or ID to a channel ID.
 */
export async function getUploadsPlaylistId(handle: string): Promise<string> {
    try {
        const channelInfo = await invoke<ChannelInfo>('resolve_channel', { query: handle });
        return channelInfo.channelId;
    } catch (error: any) {
        throw new Error(error || 'Could not find channel. Use @handle or channel ID.');
    }
}

/**
 * Fetch videos from a channel or playlist.
 */
export async function getVideos(id: string, isPlaylist: boolean = false, continuation: string | null = null): Promise<VideoResponse> {
    try {
        const res = await invoke<VideoResponse>('fetch_videos', { id, isPlaylist, continuation });

        // If it's the initial fetch (no continuation), fetch view counts in background
        if (!continuation) {
            fetchViewCountsInBackground(res.videos);
        }

        return res;
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch videos');
    }
}

/**
 * Fetch view counts for videos in the background.
 */
async function fetchViewCountsInBackground(videos: Video[]) {
    // Only fetch for the first few to avoid rate limiting
    const videosToFetch = videos.slice(0, 15);
    for (const video of videosToFetch) {
        try {
            const viewCount = await invoke<string>('fetch_view_count', { videoId: video.id });
            video.viewCount = viewCount;
            window.dispatchEvent(new CustomEvent('video-updated', {
                detail: { videoId: video.id, viewCount }
            }));
        } catch (e) {
            // Silently skip
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

/**
 * Fetch direct video info for a single ID.
 */
export async function getVideoInfo(videoId: string): Promise<Video> {
    try {
        return await invoke<Video>('fetch_video_info', { videoId });
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch video info');
    }
}

/**
 * Fetch transcript for a video.
 */
export async function getTranscript(videoId: string): Promise<string> {
    try {
        return await invoke('fetch_transcript', { videoId });
    } catch (e: any) {
        return typeof e === 'string' ? e : "Could not load transcript.";
    }
}
/**
 * Check if the API key exists on the backend.
 */
export async function checkApiKey(): Promise<boolean> {
    return await invoke<boolean>('check_api_key');
}

/**
 * Save the API key to the backend.
 */
export async function saveApiKey(key: string): Promise<void> {
    try {
        await invoke('save_api_key', { key });
    } catch (error: any) {
        throw new Error(error || 'Failed to save API key');
    }
}
