import { invoke } from '@tauri-apps/api/core';

export interface Video {
    id: string;
    title: string;
    thumbnail: string;
    publishedAt: string;
    viewCount: string;
    author?: string;
    status?: 'exists' | 'saved';
    dateAdded?: string;
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
        // Python backend fetches all videos for playlist/channel, search is single page.
        // Continuation logic currently disabled/noop in backend for this implementation.
        const res = await invoke<VideoResponse>('fetch_videos', { id, isPlaylist, continuation });
        return res;
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch videos');
    }
}

/**
 * Fetch channel videos using YouTube Data API v3.
 */
export async function fetchChannelVideosV3(query: string, continuation: string | null = null): Promise<VideoResponse> {
    try {
        return await invoke<VideoResponse>('fetch_channel_videos_v3', { query, continuation });
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch channel videos');
    }
}

/**
 * Fetch direct video info for a single ID.
 * Uses kinesis-cli -i (fast metadata)
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
 * Uses manager.py (fetches and caches)
 */
export async function getTranscript(videoId: string): Promise<string> {
    try {
        return await invoke('fetch_transcript', { videoId });
    } catch (e: any) {
        return typeof e === 'string' ? e : "Could not load transcript.";
    }
}

/**
 * Save video metadata and transcript to database.
 */
export async function saveVideo(videoId: string): Promise<Video> {
    try {
        return await invoke<Video>('save_video', { videoId });
    } catch (error: any) {
        throw new Error(error || 'Failed to save video');
    }
}

/**
 * Search YouTube videos.
 */
export async function searchVideos(query: string): Promise<VideoResponse> {
    try {
        return await invoke<VideoResponse>('search_videos', { query });
    } catch (error: any) {
        throw new Error(error || 'Failed to search videos');
    }
}

export async function getSavedVideos(): Promise<VideoResponse> {
    try {
        const res = await invoke<VideoResponse>('fetch_saved_videos');
        return res;
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch saved videos');
    }
}

export async function deleteVideo(id: string): Promise<string> {
    try {
        return await invoke<string>('delete_video', { videoId: id });
    } catch (error: any) {
        throw new Error(error || 'Failed to delete video');
    }
}

export async function checkVideoExists(id: string): Promise<boolean> {
    try {
        return await invoke<boolean>('check_video_exists', { videoId: id });
    } catch (error: any) {
        return false;
    }
}

export async function bulkSaveVideos(ids: string[]): Promise<any[]> {
    try {
        return await invoke<any[]>('bulk_save_videos', { videoIds: ids });
    } catch (error: any) {
        throw new Error(error || 'Failed to bulk save videos');
    }
}

export async function getApiKey(): Promise<string | null> {
    try {
        return await invoke<string | null>('get_api_key');
    } catch {
        return null;
    }
}

export async function setApiKey(apiKey: string): Promise<void> {
    try {
        await invoke('set_api_key', { apiKey });
    } catch (error: any) {
        throw new Error(error || 'Failed to set API key');
    }
}

export async function removeApiKey(): Promise<void> {
    try {
        await invoke('remove_api_key');
    } catch (error: any) {
        throw new Error(error || 'Failed to remove API key');
    }
}

export interface DisplaySettings {
    resolution: string;
    fullscreen: boolean;
}

export interface DbDetails {
    path: string;
    size_bytes: number;
    video_count: number;
}

export async function openDbLocation(): Promise<void> {
    try {
        await invoke('open_db_location');
    } catch (error: any) {
        throw new Error(error || 'Failed to open DB location');
    }
}

export async function getDbDetails(): Promise<DbDetails> {
    try {
        return await invoke<DbDetails>('get_db_details');
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch DB details');
    }
}

export async function getDisplaySettings(): Promise<DisplaySettings> {
    try {
        return await invoke<DisplaySettings>('get_display_settings');
    } catch (error: any) {
        throw new Error(error || 'Failed to fetch display settings');
    }
}

export async function setDisplaySettings(settings: DisplaySettings): Promise<void> {
    try {
        await invoke('set_display_settings', { settings });
    } catch (error: any) {
        throw new Error(error || 'Failed to set display settings');
    }
}


