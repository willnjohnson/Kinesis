import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LinkKind } from "./lib/internal-links";

export interface Video {
    id: string;
    title: string;
    thumbnail: string;
    author?: string;
    description?: string;
    duration?: string;
    views?: string;
    publishedTime?: string;
    viewCount: string;
    publishedAt: string;
    dateAdded?: string;
    handle?: string;
    status?: string;
    transcript?: string;
    summary?: string;
    tags?: string;
    hasTranscript?: boolean;
    hasSummary?: boolean;
    lengthSeconds?: number;
    // Warp Drive taxonomy designator, in storage encoding (e.g. "θψUAP_GERB_PND") — empty/absent
    // means unassigned ("Universe"). See updateVideoWdbs for the user-facing ":UAP-GERB-PND" form.
    wdbs?: string;
}

export interface SearchResponse {
    videos: Video[];
    continuation: string | null;
    totalCount?: number;
}

export type LibrarySortField = 'date' | 'added' | 'popularity';
export type LibrarySortOrder = 'asc' | 'desc';
export type LibraryFilterKind = 'all' | 'transcript' | 'summary';

export interface LibraryQueryOptions {
    filterKind?: LibraryFilterKind;
    sortField?: LibrarySortField;
    sortOrder?: LibrarySortOrder;
    limit?: number;
    offset?: number;
}

export interface DbDetails {
    path: string;
    size_bytes: number;
    video_count: number;
    history_count: number;
    channel_count: number;
    /** Every Drive entry at any depth. */
    drive_count: number;
    /** Standard Glossary Tags (with a definition). */
    glossary_count: number;
    quick_tag_count: number;
    biography_count: number;
    attachment_count: number;
    /** What attachments take up in the database, after compression. */
    attachment_bytes: number;
    /** The Calendar's tracks, the notes and workbooks (shared and personal together), the logs and their days. */
    track_count: number;
    note_count: number;
    workbook_count: number;
    log_count: number;
    log_entry_count: number;
}

export interface DisplaySettings {
    resolution: string;
    fullscreen: boolean;
    theme: string;
    videoListMode: 'grid' | 'compact';
    navigationOrientation: 'horizontal' | 'vertical' | 'titlebar';
}

export interface HistoryEntry {
    id: number;
    search_query: string;
    searchedAt: string;
}

export interface ChannelInfo {
    channelId: string;
    channelName: string;
}

export async function getVideos(id: string, isPlaylist: boolean, continuation?: string | null): Promise<SearchResponse> {
    return await invoke("fetch_videos", { id, isPlaylist, continuation });
}

export async function getTranscript(id: string): Promise<string> {
    return await invoke("fetch_transcript", { videoId: id });
}

export async function getVideoHandle(id: string): Promise<string | null> {
    return await invoke("fetch_video_handle", { videoId: id });
}

export async function summarizeTranscript(transcript: string, handle?: string, videoId?: string): Promise<string> {
    return await invoke("summarize_transcript", { transcript, handle: handle ?? null, videoId: videoId ?? null });
}

export async function getVideoInfo(id: string): Promise<Video> {
    return await invoke("fetch_video_info", { videoId: id });
}

export async function saveVideo(video: Video, transcript: string, summary?: string | null): Promise<Video> {
    // Pass along what was already successfully fetched for this video (search results +
    // the transcript/handle fetched when it was opened) so the backend can save directly
    // instead of redundantly re-fetching from YouTube, which is flaky under some network/VPN
    // conditions even though nothing here actually needs re-fetching.
    return await invoke("save_video", {
        videoId: video.id,
        summary,
        title: video.title,
        author: video.author,
        handle: video.handle,
        thumbnail: video.thumbnail,
        lengthSeconds: video.lengthSeconds,
        viewCount: video.viewCount,
        publishedAt: video.publishedAt,
        transcript,
    });
}

export async function searchVideos(query: string, continuation?: string | null): Promise<SearchResponse> {
    return await invoke("search_videos", { query, continuation });
}

export async function getSavedVideos(includeContent?: boolean, opts?: LibraryQueryOptions): Promise<SearchResponse> {
    return await invoke("fetch_saved_videos", {
        includeContent,
        filterKind: opts?.filterKind,
        sortField: opts?.sortField,
        sortOrder: opts?.sortOrder,
        limit: opts?.limit,
        offset: opts?.offset,
    });
}

export async function searchLibrary(query: string, opts?: LibraryQueryOptions): Promise<SearchResponse> {
    return await invoke("search_library", {
        query,
        filterKind: opts?.filterKind,
        sortField: opts?.sortField,
        sortOrder: opts?.sortOrder,
        limit: opts?.limit,
        offset: opts?.offset,
    });
}

/** A Quick Tag's newest videos and how many carry it (`totalCount`), for the Glossary's tag preview. */
export async function getTagVideosPreview(tag: string, limit?: number): Promise<SearchResponse> {
    return await invoke("get_tag_videos_preview", { tag, limit });
}

/** Deletes a saved video. It goes to the Trash (see `trashList`); the Trash id comes back so the delete can be undone. */
export async function deleteVideo(id: string): Promise<number | null> {
    const trashId = await invoke<number | null>("delete_video", { videoId: id });
    notifyTrashChanged();
    return trashId;
}

/** Deletes many videos at once (the Orphaned window's Delete All), each to the Trash as its own item to put back. */
export async function deleteVideos(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const count = await invoke<number>("delete_videos", { videoIds: ids });
    notifyTrashChanged();
    return count;
}

export async function bulkSaveVideos(ids: string[]): Promise<any[]> {
    return await invoke("bulk_save_videos", { videoIds: ids });
}

/** A channel's videos, newest first, without an API key (the same list as the channel's Videos tab). */
export async function fetchChannelVideosKeyless(handle: string, continuationToken?: string | null): Promise<SearchResponse> {
    return await invoke("fetch_channel_videos_keyless", { query: handle, continuation: continuationToken ?? null });
}

export async function fetchChannelVideosV3(handle: string, continuationToken?: string | null): Promise<SearchResponse> {
    return await invoke("fetch_channel_videos_v3", { query: handle, continuation: continuationToken ?? null });
}

export async function getApiKey(): Promise<string | null> {
    return await invoke("get_api_key");
}

export async function setApiKey(key: string): Promise<void> {
    await invoke("set_api_key", { apiKey: key });
}

export async function removeApiKey(): Promise<void> {
    await invoke("remove_api_key");
}

export async function openDbLocation(): Promise<void> {
    await invoke("open_db_location");
}

export async function getDbDetails(): Promise<DbDetails> {
    return await invoke("get_db_details");
}

export async function getDisplaySettings(): Promise<DisplaySettings> {
    return await invoke("get_display_settings");
}

export async function setDisplaySettings(settings: DisplaySettings): Promise<void> {
    await invoke("set_display_settings", { settings });
}

export async function getSearchHistory(limit: number): Promise<HistoryEntry[]> {
    return await invoke("get_search_history", { limit });
}

export async function addSearchHistory(query: string): Promise<void> {
    await invoke("add_search_history", { query });
}

/** Deletes the searches made on `date` (YYYY-MM-DD), and only that day. */
export async function clearHistoryDay(date: string): Promise<void> {
    await invoke("clear_history_day", { date });
}

export async function deleteHistoryEntry(id: number): Promise<void> {
    await invoke("delete_history_entry", { id });
}

export async function clearAllHistory(): Promise<void> {
    await invoke("clear_all_history");
}

/** One saved video (with its summary and transcript), or null when it isn't in this library. */
export async function getVideoById(videoId: string): Promise<Video | null> {
    return await invoke("get_video_by_id", { videoId });
}

/** A saved video as its card shows it, without the transcript (light enough for a hover preview). */
export async function getVideoCard(videoId: string): Promise<Video | null> {
    return await invoke("get_video_card", { videoId });
}

export async function checkVideoExists(id: string): Promise<boolean> {
    return await invoke("check_video_exists", { videoId: id });
}

export async function getSimilarVideos(videoId: string, limit?: number): Promise<Video[]> {
    return await invoke("get_similar_videos", { videoId, limit: limit ?? null });
}

export async function resolveChannel(query: string): Promise<ChannelInfo> {
    return await invoke("resolve_channel", { query });
}

export async function fetchViewCount(videoId: string): Promise<string> {
    return await invoke("fetch_view_count", { videoId });
}

export async function getSetting(key: string): Promise<string | null> {
    return await invoke("get_setting", { key });
}

/** Several settings in one call (the sync server's enforced values applied); missing keys are null. */
export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
    return await invoke("get_settings", { keys });
}

export async function setSetting(key: string, value: string): Promise<void> {
    await invoke("set_setting", { key, value });
}

/** Every customizable name (workspace name and aliases) with defaults filled in. */
export async function getWorkspaceLabels(): Promise<Record<string, string>> {
    return await invoke("get_workspace_labels");
}

/** Sets one name; an empty value resets it. Resolves to the value now in effect, rejects with a readable message. */
export async function setWorkspaceLabel(key: string, value: string): Promise<string> {
    return await invoke("set_workspace_label", { key, value });
}

export async function getOllamaModel(): Promise<string> {
    return await invoke("get_ollama_model");
}

export async function setOllamaModel(model: string): Promise<void> {
    await invoke("set_ollama_model", { model });
}

export async function getOllamaPrompt(): Promise<string> {
    return await invoke("get_ollama_prompt");
}

export async function setOllamaPrompt(prompt: string): Promise<void> {
    await invoke("set_ollama_prompt", { prompt });
}

export async function checkOllama(): Promise<boolean> {
    return await invoke("check_ollama");
}

export async function checkModelPulled(): Promise<boolean> {
    return await invoke("check_model_pulled");
}

export async function pullModel(): Promise<void> {
    await invoke("pull_model");
}

export async function deleteModel(): Promise<void> {
    await invoke("delete_model");
}

export async function installOllama(): Promise<void> {
    await invoke("install_ollama");
}

/** Saves a summary and returns the video's tags afterward (comma-joined, split the same way
 *  Video.tags is parsed elsewhere): saving syncs the Term subset of the tags to whatever glossary
 *  links are now in the summary (see src-tauri/src/db/summaries.rs's `sync_terms_from_video_text`),
 *  so the caller needs the result of that, not just an acknowledgement that it saved. */
export async function saveSummary(videoId: string, summary: string): Promise<string> {
    return await invoke("save_summary", { videoId, summary });
}

export async function saveTags(videoId: string, tags: string): Promise<void> {
    await invoke("save_tags", { videoId, tags });
}

export async function saveTranscript(videoId: string, transcript: string): Promise<void> {
    await invoke("save_transcript", { videoId, transcript });
}

export async function getSummary(videoId: string): Promise<string | null> {
    return await invoke("get_summary", { videoId });
}

export async function getSummarizedCount(): Promise<number> {
    return await invoke("get_summarized_count");
}

export async function getVideosWithSummaries(): Promise<string[]> {
    return await invoke("get_videos_with_summaries");
}

export async function summarizeAllVideos(): Promise<number> {
    return await invoke("summarize_all_videos");
}

export async function getVeniceApiKey(): Promise<string | null> {
    return await invoke("get_venice_api_key");
}

export async function setVeniceApiKey(key: string): Promise<void> {
    await invoke("set_venice_api_key", { apiKey: key });
}

export async function removeVeniceApiKey(): Promise<void> {
    await invoke("remove_venice_api_key");
}

export async function getVenicePrompt(): Promise<string> {
    return await invoke("get_venice_prompt");
}

export async function setVenicePrompt(prompt: string): Promise<void> {
    await invoke("set_venice_prompt", { prompt });
}

/** Opens a folder picker (at `startDir` when given and it still exists). */
export async function selectFolder(startDir?: string | null): Promise<string | null> {
    return await invoke("select_folder", { startDir: startDir ?? null });
}

export async function setDbPath(path: string): Promise<string> {
    return await invoke("set_db_path_override", { folderPath: path });
}

export interface ExportSummary {
    videos_exported: number;
    glossary_terms: number;
    biographies: number;
    calendar_tracks: number;
    notes: number;
    logs: number;
    folder_path: string;
}

/** Which Drives an export leaves out, and what happens to what touches them. */
export interface DriveScopeOptions {
    /** Drive paths to leave out, e.g. ":UAP". Empty exports everything. */
    excluded: string[];
    /** Terms filed under a left-out Drive: keep them without it, or leave out those filed only there. */
    terms: "keep" | "drop";
    /** A video homed in a left-out Drive but linked into a kept one stays, and moves its home there. */
    keepLinkedVideos: boolean;
    /** A video homed in a left-out Drive with no link into a kept one stays, uncategorized. */
    keepUnlinkedVideos: boolean;
    /** Links in kept text to anything left out become plain text (kinpak only; a vault always does this). */
    unlinkText: boolean;
}

export const DEFAULT_DRIVE_SCOPE: DriveScopeOptions = { excluded: [], terms: "keep", keepLinkedVideos: true, keepUnlinkedVideos: false, unlinkText: true };

/** One Drive as the export pickers list it. */
export interface ExportDrive {
    path: string;
    segment: string;
    alias: string | null;
    /** Videos whose home is in this Drive. */
    videos: number;
}

export async function getExportDrives(): Promise<ExportDrive[]> {
    return await invoke("get_export_drives");
}

export interface ObsidianOptions {
    videos: boolean;
    transcripts: boolean;
    glossary: boolean;
    biographies: boolean;
    /** A note per Calendar track, its items as a checklist. */
    calendar: boolean;
    /** The Notes section's notes, shared and personal. */
    notes: boolean;
    /** The Logs section's logs: a note each, its days as a table. */
    logs: boolean;
    drives: DriveScopeOptions;
}

/** Exports the library as an Obsidian vault into `vaultPath`, a NEW folder: if that name is already
 *  taken the export writes to "name (2)" etc. instead. The summary's `folder_path` is where it went. */
export async function exportToObsidian(vaultPath: string, options?: ObsidianOptions): Promise<ExportSummary> {
    return await invoke("export_to_obsidian", { vaultPath, options });
}

/** Save As dialog whose chosen name is the vault folder itself; null if cancelled. */
export async function selectVaultPath(defaultName: string, startDir?: string | null): Promise<string | null> {
    return await invoke("select_vault_path", { defaultName, startDir: startDir ?? null });
}

export interface AppInfo {
    name: string;
    version: string;
}

export async function getAppInfo(): Promise<AppInfo> {
    return await invoke("get_app_info");
}

export async function getEmbedServerPort(): Promise<number | null> {
    return await invoke("get_embed_server_port");
}

/** One Glossary row: a definition of a term and every top-level Drive (":PRIV") it's filed under.
 *  Empty `drives` means uncategorized (which is also where Quick Tags live). The same term can have
 *  a different definition in different Drives, but a Drive belongs to one definition of a term. */
export interface GlossaryTerm {
    term: string;
    definition: string;
    drives: string[];
}

export interface BiographyEntry {
    handle: string;
    displayName: string;
    bio: string;
    wikipedia: string;
    website: string;
    twitter: string;
    instagram: string;
    facebook: string;
    threads: string;
    youtube: string;
    tiktok: string;
    twitch: string;
    reddit: string;
    discord: string;
    /** Optional: the reader's own name for the channel (the person behind it, say), shown as a badge before its display
     *  name. "" when there's none. */
    alias: string;
}
export async function addGlossaryTerm(term: string, definition: string): Promise<void> {
    await invoke("add_glossary_term", { term, definition });
}

/** Every row, sorted by term. A term with several definitions appears once per definition. */
export async function getGlossaryTerms(): Promise<GlossaryTerm[]> {
    return await invoke("get_glossary_terms");
}

/** Deletes one entry: the row of `term` filed under exactly `drives` (empty = the uncategorized row). */
export async function deleteGlossaryTerm(term: string, drives: string[]): Promise<number | null> {
    const trashId = await invoke<number | null>("delete_glossary_term", { term, drives });
    notifyTrashChanged();
    return trashId;
}

// ─── Trash ───────────────────────────────────────────────────────────────────
// What was deleted this session, kept in the app's memory (never saved), so a delete can be undone. It's emptied
// when the app closes or the workspace changes.

export type TrashKind = 'video' | 'glossary' | 'note';

export interface TrashEntry {
    id: number;
    kind: TrashKind;
    /** What makes two deletions "the same thing": a video's id, or a term with its Drives. */
    key: string;
    label: string;
    detail: string;
    /** Milliseconds since the epoch. */
    deleted_at: number;
}

/** Fired on `window` whenever the Trash changes, so every place that shows it can refresh. */
export const TRASH_CHANGED_EVENT = 'kinesis-trash-changed';
/** Fired (with the kind as its `detail`) when something is put back from a place other than the Trash window, so the
 *  section that shows that kind of item can reload. */
export const TRASH_RESTORED_EVENT = 'kinesis-trash-restored';
function notifyTrashChanged() {
    window.dispatchEvent(new Event(TRASH_CHANGED_EVENT));
}

/** Fired on `window` when the list of orphaned videos may have changed (a video was found gone, or answered again). */
export const ORPHANS_CHANGED_EVENT = 'kinesis-orphans-changed';

/** What opening a saved video found out from YouTube (by its ID, no API key): "ok" (with the old and new title when it
 *  was renamed, already taken over), "orphaned" (YouTube no longer has it), or "unknown" (YouTube couldn't be asked). */
export interface VideoIdentityCheck {
    status: 'ok' | 'orphaned' | 'unknown';
    oldTitle: string | null;
    newTitle: string | null;
    reason: string | null;
    /** Its view count now, when that had changed since it was stored (already saved); null when it hadn't. */
    viewCount: string | null;
}

export async function checkVideoIdentity(videoId: string): Promise<VideoIdentityCheck> {
    const result = await invoke<VideoIdentityCheck>("check_video_identity", { videoId });
    if (result.status !== 'unknown') window.dispatchEvent(new Event(ORPHANS_CHANGED_EVENT));
    return result;
}

/** Where the reader left a saved video (seconds in, and its length when known), for the sidebar's Resume. */
export interface VideoPosition {
    seconds: number;
    duration: number | null;
}

export async function getVideoPosition(videoId: string): Promise<VideoPosition | null> {
    return await invoke("get_video_position", { videoId });
}

/** Records where the reader is in a saved video; 0 forgets it (it played to its end). */
export async function setVideoPosition(videoId: string, seconds: number, duration: number | null): Promise<void> {
    await invoke("set_video_position", { videoId, seconds, duration });
}

/** Fired on `window` when the Continue Watching or Watched lists may have changed. */
export const WATCH_LISTS_CHANGED_EVENT = 'kinesis-watch-lists-changed';
const watchListsChanged = () => window.dispatchEvent(new Event(WATCH_LISTS_CHANGED_EVENT));

/** A video in the pin menu's Continue Watching or Watched lists. */
export interface ListedVideo {
    videoId: string;
    title: string;
    author: string;
    /** Continue Watching: where it was left, and its length when known. */
    seconds: number | null;
    duration: number | null;
    /** When it was last watched (Continue Watching) or finished (Watched): "2026-10-06 14:03:12.000", UTC. */
    at: string;
}

/** Saved videos started and not finished, the most recent first. */
export async function listContinueWatching(): Promise<ListedVideo[]> {
    return await invoke("list_continue_watching");
}

/** Every video marked watched, the most recently finished first. */
export async function listWatchedVideos(): Promise<ListedVideo[]> {
    return await invoke("list_watched_videos");
}

/** Marks a saved video watched (which forgets where it was left) or not. */
export async function setVideoWatched(videoId: string, watched: boolean): Promise<void> {
    await invoke("set_video_watched", { videoId, watched });
    watchListsChanged();
}

/** Continue Watching's Mark as Completed: watched, and done on every Calendar track it's on. */
export async function completeVideo(videoId: string): Promise<number> {
    const marked = await changeCalendar<number>("complete_video", { videoId, today: calendarToday() });
    watchListsChanged();
    return marked;
}

/** A saved video YouTube no longer has: kept in the library for the record, listed in the Orphaned window. */
export interface OrphanedVideo {
    videoId: string;
    title: string;
    author: string;
    reason: string;
    foundAt: string;
}

export async function listOrphanedVideos(): Promise<OrphanedVideo[]> {
    return await invoke("list_orphaned_videos");
}

export async function trashList(kind: TrashKind): Promise<TrashEntry[]> {
    return await invoke("trash_list", { kind });
}

/** Puts a deleted item back. Rejects with the reason when it can't be (say, it was made again since). */
export async function trashRestore(id: number): Promise<void> {
    try {
        await invoke("trash_restore", { id });
    } finally {
        notifyTrashChanged();
    }
}

export async function trashDiscard(id: number): Promise<void> {
    await invoke("trash_discard", { id });
    notifyTrashChanged();
}

export async function trashEmpty(kind: TrashKind): Promise<void> {
    await invoke("trash_empty", { kind });
    notifyTrashChanged();
}

/** A Drive a Standard Glossary Tag can be filed under, with the Drives beneath it. getWdbsRoots
 *  returns the top level; deeper levels hang off `children`. */
export interface WdbsRoot {
    /** Display path, e.g. ":CRYPTO" or ":CRYPTO-DOAC" (what assignments are stored as). */
    path: string;
    /** The node's own name shown in the UI, e.g. "CRYPTO" or "DOAC". */
    segment: string;
    /** The curated alias, when it differs from `segment`. */
    alias: string | null;
    /** The Drives one level down, sorted by name. */
    children: WdbsRoot[];
}

/** Adds or edits one definition and the Drives (any level) it's filed under (one row).
 *  `original` is the entry being edited (its term and Drives): its row is replaced, and filing under
 *  a Drive where the term already has a different definition is refused. Quick Tags (empty
 *  definition) are always uncategorized; no Drives = uncategorized. */
export async function saveGlossaryTerm(original: { term: string; drives: string[] } | null, term: string, definition: string, drives: string[]): Promise<void> {
    await invoke("save_glossary_term", { originalTerm: original?.term ?? null, originalDrives: original?.drives ?? null, term, definition, drives });
}

export async function getWdbsRoots(): Promise<WdbsRoot[]> {
    return await invoke("get_wdbs_roots");
}

// ─── Notes (src-tauri/src/db/notes.rs) ───────────────────────────────────────
// Pages of the reader's own writing, citing videos, moments and passages as ordinary in-app links. Shared notes travel
// with the workspace (a Kinpak); personal ones are each reader's own, like pins, and allowed in a read-only workspace.

export interface Note {
    id: string;
    /** "" while it's Untitled. */
    title: string;
    body: string;
    /** The Drives it's filed under, at any level (":GERMAN-CH2"), as a glossary term is. */
    drives: string[];
    shared: boolean;
    createdAt: string;
    updatedAt: string;
}

/** Fired (on window) after a note is made, changed, moved or deleted anywhere in the app, with the note's id as detail
 *  (null for "anything"). The Notes section and the cite commands keep in step through it. */
export const NOTES_CHANGED_EVENT = 'kinesis:notes-changed';

function notesChanged(id: string | null) {
    window.dispatchEvent(new CustomEvent<string | null>(NOTES_CHANGED_EVENT, { detail: id }));
}

/** Every note, shared and personal, the most recently changed first. */
export async function listNotes(): Promise<Note[]> {
    return await invoke("list_notes");
}

export async function getNote(id: string): Promise<Note | null> {
    return await invoke("get_note", { id });
}

export async function createNote(note: { shared: boolean; title?: string; body?: string; drives?: string[] }): Promise<Note> {
    const made = await invoke("create_note", { shared: note.shared, title: note.title ?? '', body: note.body ?? '', drives: note.drives ?? [] }) as Note;
    notesChanged(made.id);
    return made;
}

/** Saves a note. Doesn't announce itself: the Notes section is what saves as you type, and it already knows. */
export async function updateNote(id: string, title: string, body: string, drives: string[]): Promise<Note> {
    return await invoke("update_note", { id, title, body, drives });
}

/** Adds a paragraph (a citation) to the end of a note. */
export async function appendToNote(id: string, text: string): Promise<Note> {
    const note = await invoke("append_to_note", { id, text }) as Note;
    notesChanged(id);
    return note;
}

/** Makes a note shared or personal (it keeps its id, its links and its Calendar places). */
export async function setNoteShared(id: string, shared: boolean): Promise<Note> {
    const note = await invoke("set_note_shared", { id, shared }) as Note;
    notesChanged(id);
    return note;
}

/** Deletes a note to the Trash. Resolves to its Trash id (null if there was no such note). */
export async function deleteNote(id: string): Promise<number | null> {
    const trashId = await invoke("delete_note", { id }) as number | null;
    notesChanged(id);
    window.dispatchEvent(new Event(TRASH_CHANGED_EVENT));
    // Its places on Calendar tracks turned into tasks.
    window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
    return trashId;
}

// ── Drive sequences (see db/sequences.rs) ────────────────────────────────────
// One ordered watch-through list per Drive. `drive` is always the display path (":CS-DSA").

/** Where a video stands in one Drive's sequence. */
export interface DriveSequenceState {
    drive: string;
    /** Videos in the sequence (0 = the Drive has none yet). */
    total: number;
    /** The video's place counted from 1; null when it isn't in this sequence. */
    position: number | null;
    first: string | null;
    prev: string | null;
    next: string | null;
}

export interface SequenceEntry {
    videoId: string;
    title: string;
    position: number;
}

export interface AddToSequenceOutcome {
    added: number;
    /** Skipped: already in the sequence. */
    alreadyIn: number;
    /** Skipped: not filed at or beneath the Drive. */
    notInDrive: number;
}

/** A video that could be added to a Drive's sequence. */
export interface DriveVideo {
    videoId: string;
    title: string;
    author: string | null;
    publishedAt: string | null;
}

export interface DriveVideoPage {
    videos: DriveVideo[];
    /** How many match across all pages. */
    total: number;
}

/** What to order videos by: upload date, when added to the library, or title (natural: "2" before "10"). */
export type SequenceSort = 'published' | 'added' | 'views' | 'title';

/** Videos filed at or beneath `drive` (home or "Also in") that aren't in its sequence yet, in `sort` order. */
export async function listDriveVideosForSequence(drive: string, query: string, sort: SequenceSort, descending: boolean, limit: number, offset: number): Promise<DriveVideoPage> {
    return await invoke("list_drive_videos_for_sequence", { drive, query, sort, descending, limit, offset });
}

/** Adds every video the picker lists for `query` (all pages) in `sort` order, except `excluded`. `tail`
 *  is for ones unticked and ticked again: they go after all the rest, in the order given (they're in
 *  `excluded` too, so the ordered pass skips them). */
export async function addMatchingToDriveSequence(drive: string, query: string, sort: SequenceSort, descending: boolean, excluded: string[], tail: string[] = []): Promise<AddToSequenceOutcome> {
    return await invoke("add_matching_to_drive_sequence", { drive, query, sort, descending, excluded, tail });
}

export async function getVideoSequences(videoId: string, drives: string[]): Promise<DriveSequenceState[]> {
    return await invoke("get_video_sequences", { videoId, drives });
}

/** A Drive one level beneath another. */
export interface ChildDrive {
    /** Display path, e.g. ":DUPED-FRW-PND". */
    drive: string;
    /** Videos filed at or beneath it. */
    videos: number;
    /** How many videos its sequence has (0 = none yet). */
    sequenceTotal: number;
}

/** The sub-drives one level beneath `drive`, in name order. */
export async function getChildDrives(drive: string): Promise<ChildDrive[]> {
    return await invoke("get_child_drives", { drive });
}

export async function getDriveSequence(drive: string): Promise<SequenceEntry[]> {
    return await invoke("get_drive_sequence", { drive });
}

/** Appends videos to the end of a Drive's sequence: in the order given, or ordered by `order` when set. */
export async function addToDriveSequence(drive: string, videoIds: string[], order?: { sort: SequenceSort; descending: boolean }): Promise<AddToSequenceOutcome> {
    return await invoke("add_to_drive_sequence", { drive, videoIds, sort: order?.sort, descending: order?.descending });
}

export async function removeFromDriveSequence(drive: string, videoId: string): Promise<void> {
    await invoke("remove_from_drive_sequence", { drive, videoId });
}

export async function setDriveSequenceOrder(drive: string, videoIds: string[]): Promise<void> {
    await invoke("set_drive_sequence_order", { drive, videoIds });
}

export async function clearDriveSequence(drive: string): Promise<void> {
    await invoke("clear_drive_sequence", { drive });
}

// ── Calendar (src-tauri/src/db/calendar.rs) ──────────────────────────────────────────────────────

/** How a track moves along: when the last entry is done, on its schedule's days, or both. */
export type CalendarAdvanceMode = 'completion' | 'calendar' | 'hybrid';

/** How a dated track's days repeat, from its start (Repeat in db/calendar.rs):
 *   - `weekly`: on its weekdays, every `every` weeks (1 = every week, 2 = every other week);
 *   - `interval`: every `every` days counted from its start (2 = every other day); its weekdays aren't used;
 *   - `monthly`: the `ordinal`th of each of its weekdays in every month (1 = first ... 4 = fourth, 5 = last). */
export type CalendarRepeatKind = 'weekly' | 'interval' | 'monthly';
export interface CalendarRepeat {
    kind: CalendarRepeatKind;
    every: number;
    ordinal: number;
}

export interface CalendarTrack {
    id: number;
    name: string;
    /** The Drive it belongs to (":CS-DSA"), or "" for none. */
    drive: string;
    advanceMode: CalendarAdvanceMode;
    loopEntries: boolean;
    /** Its order is read live off its Drive's sequence. */
    sourceDriveSequence: boolean;
    /** The days its schedule runs on, 1 (Monday) to 7 (Sunday). Empty for a `completion` track, and for one that repeats
     *  every N days. */
    weekdays: number[];
    /** How those days repeat; every week for a `completion` track (which has none). */
    repeat: CalendarRepeat;
    startDate: string;
    archived: boolean;
    createdAt: string;
    /** A dated track's time window: its start in minutes after midnight, and its length in minutes. Null for any time that day. */
    timeStart: number | null;
    timeDuration: number | null;
    /** The cycle its current run began at (0 until it's started over). */
    cycleOffset: number;
}

export interface CalendarTrackInput {
    name: string;
    drive: string;
    advanceMode: CalendarAdvanceMode;
    loopEntries: boolean;
    sourceDriveSequence: boolean;
    weekdays: number[];
    /** How its days repeat; every week on its weekdays when left out. */
    repeat?: CalendarRepeat;
    /** When its schedule starts ("2026-09-07"); today when left out. */
    startDate?: string;
    /** A time window on its days; both null for any time that day. It can't clash with another track's (the backend refuses). */
    timeStart: number | null;
    timeDuration: number | null;
}

export interface CalendarEntry {
    /** 0 for a video in a Drive's sequence that has no row of its own yet. */
    id: number;
    videoId: string | null;
    /** A note's entry (the Notes section): the note's id. Never with a video. */
    noteId: string | null;
    /** The workbook the note was added as a page of, which it opens in (null for a note added on its own). */
    workbookId: string | null;
    label: string;
    /** What to call it: its label, else its video's title, else its note's ("Untitled" without one). */
    title: string;
    targetDate: string | null;
    /** A task's icon, a name from lib/calendar-icons.ts ("tree-palm"); "" for the default. */
    icon: string;
    description: string;
    /** 0 none, 1 low, 2 medium, 3 high: a marker only (it doesn't change the entry's place or day). */
    priority: number;
    /** Marked done in the track's current cycle. */
    done: boolean;
    /** Marked In progress in the current cycle (started, not finished; never true with `done`). */
    inProgress: boolean;
    /** The day the schedule gives it this cycle (dated tracks only). */
    dueDate: string | null;
    /** A folder: a group of the entries after it (theirs is `folderId`) that share one place, so one day on a dated track.
     *  Its `done` is all of them done, its `inProgress` some started or done but not all (both worked out, never set). */
    isFolder: boolean;
    /** The folder it's in, if any. */
    folderId: number | null;
    /** Its place among the track's videos and tasks, from 1 ("4 of 12"); 0 for a folder. */
    place: number;
}

export interface CalendarTrackState {
    entries: CalendarEntry[];
    /** Which entry is up (an index into `entries`); null once a track that doesn't loop is finished, or is empty. */
    current: number | null;
    currentOverdue: boolean;
    currentWaiting: boolean;
    currentDue: string | null;
    nextDate: string | null;
    done: number;
    total: number;
    /** The cycle to mark completions under now (counts on past a Start over: show `round` instead). */
    cycle: number;
    /** Which time through the list the current run is on, 0 the first. */
    round: number;
    finished: boolean;
    /** Whether its last Start over can be undone (nothing's been marked done in the run since). */
    canUndoStartOver: boolean;
}

export interface CalendarTrackSummary {
    track: CalendarTrack;
    state: CalendarTrackState;
}

export interface CalendarTerm {
    id: number;
    trackId: number;
    name: string;
    startDate: string;
    endDate: string;
    annual: boolean;
}

export interface CalendarHolidayRule {
    setId: number;
    mode: 'exclude' | 'include';
}

export interface CalendarTrackDetail extends CalendarTrackSummary {
    terms: CalendarTerm[];
    rules: CalendarHolidayRule[];
}

export interface CalendarHolidaySet {
    id: number;
    name: string;
    annual: boolean;
    /** "us_federal" for the built-in set, "" for one made by hand. */
    builtin: string;
    dates: { date: string; name: string }[];
}

/** Today on this computer's clock, as the Calendar's commands take it ("2026-09-07"). */
export function calendarToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function listCalendarTracks(includeArchived = false): Promise<CalendarTrackSummary[]> {
    return await invoke("list_calendar_tracks", { includeArchived, today: calendarToday() });
}

/** One thing on one day: a dated track's entry on its scheduled day, or an undated track's on the day it was done. */
export interface CalendarDayItem {
    trackId: number;
    date: string;
    /** 0 for a video in a Drive's sequence with no row of its own yet. */
    entryId: number;
    videoId: string | null;
    /** A note's entry: the note, to open it from its chip; and the workbook it's a page of, if added as one. */
    noteId: string | null;
    workbookId: string | null;
    title: string;
    icon: string;
    description: string;
    priority: number;
    cycle: number;
    done: boolean;
    /** Marked In progress in its cycle (never true with `done`). */
    inProgress: boolean;
    overdue: boolean;
    kind: 'scheduled' | 'completed';
    /** The folder it's in (its id and name), so the week can label a day's group. */
    folderId: number | null;
    folder: string | null;
    /** An empty folder, shown on its day as itself. */
    isFolder: boolean;
}

/** What's on each day from `from` to `to` ("2026-09-07"), across the tracks that aren't archived. */
export async function listCalendarDays(from: string, to: string): Promise<CalendarDayItem[]> {
    return await invoke("list_calendar_days", { from, to, today: calendarToday() });
}

export async function getCalendarTrack(id: number): Promise<CalendarTrackDetail> {
    return await invoke("get_calendar_track", { id, today: calendarToday() });
}

/** Sent on `window` after anything on the Calendar changes (a track, an entry, a check-off), so what shows a count of it
 *  elsewhere (the title bar's pin, PinsMenu.tsx) can refresh. */
export const CALENDAR_CHANGED_EVENT = 'kinesis:calendar-changed';

/** The same, between windows: the tray popup's Today tab and the main window check off the same items. */
const CALENDAR_CHANGED_APP_EVENT = 'kinesis-calendar-changed';
// Every window with this module turns the app-wide event into its own CALENDAR_CHANGED_EVENT.
try {
    void listen(CALENDAR_CHANGED_APP_EVENT, () => window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT))).catch(() => {});
} catch { /* not in the app (a plain browser) */ }

/** A command that changes the Calendar, then CALENDAR_CHANGED_EVENT, in every window, once it has. */
async function changeCalendar<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const result = await invoke<T>(command, args);
    // Sent to every window (this one included, which hears it through the listener above); outside the app, just here.
    emit(CALENDAR_CHANGED_APP_EVENT).catch(() => window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT)));
    return result;
}

export async function createCalendarTrack(input: CalendarTrackInput): Promise<number> {
    return await changeCalendar("create_calendar_track", { input });
}

export async function updateCalendarTrack(id: number, input: CalendarTrackInput): Promise<void> {
    await changeCalendar("update_calendar_track", { id, input });
}

export async function setCalendarTrackArchived(id: number, archived: boolean): Promise<void> {
    await changeCalendar("set_calendar_track_archived", { id, archived });
}

export async function deleteCalendarTrack(id: number): Promise<void> {
    await changeCalendar("delete_calendar_track", { id });
}

/** What adding or editing an entry gives it: a video, or (with none) a task's label; and its icon, description and priority. */
export interface CalendarEntryInput {
    videoId?: string;
    label?: string;
    icon?: string;
    description?: string;
    priority?: number;
}

/** Adds a video, or (with no video) a task, to the end of a track. */
export async function addCalendarEntry(trackId: number, entry: CalendarEntryInput): Promise<number> {
    return await changeCalendar("add_calendar_entry", {
        trackId, videoId: entry.videoId, label: entry.label, icon: entry.icon, description: entry.description, priority: entry.priority,
    });
}

/** Adds a note (the Notes section) to the end of a track, named after it. A track holds a note once. */
export async function addCalendarNoteEntry(trackId: number, noteId: string, extras: { icon?: string; description?: string; priority?: number } = {}): Promise<number> {
    return await changeCalendar("add_calendar_note_entry", { trackId, noteId, ...extras });
}

export async function updateCalendarEntry(id: number, entry: { label: string; targetDate?: string | null; icon?: string; description?: string; priority?: number }): Promise<void> {
    await changeCalendar("update_calendar_entry", {
        id, label: entry.label, targetDate: entry.targetDate ?? null, icon: entry.icon, description: entry.description, priority: entry.priority,
    });
}

/** Exports the chosen tracks' schedules from `from` to `to` as an .ics file for other calendar apps, asking where to save
 *  it. The path it was saved to, or null when the save was cancelled. */
export async function exportCalendarIcs(trackIds: number[], from: string, to: string, fileName: string): Promise<string | null> {
    return await invoke("export_calendar_ics", { trackIds, from, to, today: calendarToday(), fileName });
}

/** Starts a track over from today: its first entry again, round 1, with what was done before kept as history. */
export async function startCalendarTrackOver(id: number): Promise<void> {
    await changeCalendar("start_calendar_track_over", { id, today: calendarToday() });
}

/** A video as the title bar's pin menu lists it. */
export interface MenuVideo {
    videoId: string;
    title: string;
    author: string;
}

/** The pinned videos, newest pin first. */
export async function listPins(): Promise<MenuVideo[]> {
    return await invoke("list_pins");
}

/** Pins or unpins a video. Pinning one that isn't saved to the library is refused. */
export async function setPinned(videoId: string, pinned: boolean): Promise<void> {
    await invoke("set_pinned", { videoId, pinned });
}

export async function clearPins(): Promise<void> {
    await invoke("clear_pins");
}

// ── Workbooks (src-tauri/src/db/workbooks.rs) ────────────────────────────────────────────────────

/** Notes in an order of the author's choosing. It holds no text of its own: a name, and which notes in what order. */
export interface Workbook {
    id: string;
    title: string;
    /** Shared (it holds shared notes only), or the reader's own. */
    shared: boolean;
    /** Its notes, in order (the ones there are to read: a deleted note isn't listed). */
    noteIds: string[];
    createdAt: string;
    updatedAt: string;
}

/** Fired (on window) when a workbook is made, changed or deleted. */
export const WORKBOOKS_CHANGED_EVENT = 'kinesis:workbooks-changed';
async function changeWorkbooks<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const result = await invoke<T>(command, args);
    window.dispatchEvent(new Event(WORKBOOKS_CHANGED_EVENT));
    return result;
}

export async function listWorkbooks(): Promise<Workbook[]> {
    return await invoke("list_workbooks");
}
export async function getWorkbook(id: string): Promise<Workbook | null> {
    return await invoke("get_workbook", { id });
}
export const createWorkbook = (shared: boolean, title: string) => changeWorkbooks<Workbook>("create_workbook", { shared, title });
export const renameWorkbook = (id: string, title: string) => changeWorkbooks<Workbook>("rename_workbook", { id, title });
/** `withNotes`: its notes are shared (or made personal) with it, all or none. Without it, sharing one that holds
 *  personal notes is refused (the message says which to share first). */
export async function setWorkbookShared(id: string, shared: boolean, withNotes = false): Promise<Workbook> {
    const book = await changeWorkbooks<Workbook>("set_workbook_shared", { id, shared, withNotes });
    if (withNotes) notesChanged(null);
    return book;
}
/** Its notes stay. */
export const deleteWorkbook = (id: string) => changeWorkbooks<void>("delete_workbook", { id });
/** A personal note isn't taken into a shared workbook: the error says to share the note first. */
export const addNoteToWorkbook = (id: string, noteId: string) => changeWorkbooks<Workbook>("add_note_to_workbook", { id, noteId });
export const removeNoteFromWorkbook = (id: string, noteId: string) => changeWorkbooks<Workbook>("remove_note_from_workbook", { id, noteId });
export const reorderWorkbook = (id: string, order: string[]) => changeWorkbooks<Workbook>("reorder_workbook", { id, order });
/** Adds a workbook's notes to the end of a Calendar track, in its order: all of them, or from page `fromPage` (1 for
 *  the first) on. Resolves to how many were added (the ones already on the track are left where they are). */
export async function addCalendarWorkbook(trackId: number, workbookId: string, fromPage?: number): Promise<number> {
    return await changeCalendar("add_calendar_workbook", { trackId, workbookId, fromPage: fromPage ?? null });
}

// ── Logs (src-tauri/src/db/logs.rs) ──────────────────────────────────────────────────────────────

export interface Log {
    id: string;
    name: string;
    /** How many entries it has (0: nothing written in it yet). */
    entries: number;
    /** The date of its latest entry ("2026-10-10"), or null while it has none. */
    lastDate: string | null;
    createdAt: string;
    /** Its bell: on a day nothing's been written in it, the pin menu says so. */
    remind: boolean;
    /** What a day's Entry starts as, before anything is written for it (lib/logs.ts). */
    entryTemplate: LogEntryTemplate;
}

/** A log's entry template: `all` for any day, `days` (seven, Sunday first) for a weekday with its own. All empty for
 *  none. `{{weekday}}` and `{{date}}` in a text are filled in for the day. */
export interface LogEntryTemplate {
    all: string;
    days: string[];
}

export interface LogEntry {
    id: number;
    logId: string;
    /** The day it was made. Never changed. */
    date: string;
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
}

/** Fired (on window) when a log is made, renamed or deleted, its bell is turned, or a day is written in one: the pin
 *  menu's reminders follow it. */
export const LOGS_CHANGED_EVENT = 'kinesis:logs-changed';
async function changeLogs<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const result = await invoke<T>(command, args);
    window.dispatchEvent(new Event(LOGS_CHANGED_EVENT));
    return result;
}

export async function listLogs(): Promise<Log[]> { return await invoke("list_logs"); }
export const createLog = (name: string) => changeLogs<Log>("create_log", { name });
export const renameLog = (id: string, name: string) => changeLogs<Log>("rename_log", { id, name });
/** Deletes a log and everything written in it. */
export const deleteLog = (id: string) => changeLogs<void>("delete_log", { id });
/** Sets (or, all empty, clears) what a day's Entry starts as in a log. */
export const setLogEntryTemplate = (id: string, template: LogEntryTemplate) => changeLogs<Log>("set_log_entry_template", { id, template });
/** Turns a log's bell on or off. */
export const setLogRemind = (id: string, remind: boolean) => changeLogs<Log>("set_log_remind", { id, remind });
/** The logs with their bell on that have nothing written today. */
export async function listLogsDue(): Promise<Log[]> { return await invoke("list_logs_due", { today: calendarToday() }); }
export async function listLogEntries(logId: string): Promise<LogEntry[]> { return await invoke("list_log_entries", { logId }); }
/** Writes a log's day, which is one row: made, changed, or removed when both are left empty (null). */
export async function writeLogDay(logId: string, date: string, title: string, description: string): Promise<LogEntry | null> {
    return await changeLogs("write_log_day", { logId, date, title, description });
}

export type GraphNodeKind = 'video' | 'glossary' | 'bio' | 'note';

export interface GraphNode {
    kind: GraphNodeKind;
    /** What opening it is given (a video id, a term, a handle), as an in-app link would be. */
    key: string;
    label: string;
    /** False for a link's target with no entry here (a term or person not written up yet, a video not saved). */
    exists: boolean;
}

export interface LinkGraph {
    nodes: GraphNode[];
    /** Indexes into `nodes`; "link" for an in-app link between their texts, "creator" for a video and its creator. */
    edges: { a: number; b: number; kind: 'link' | 'creator' }[];
}

/** Every video, term, person and note, and the links and creators connecting them (the graph view). */
export async function getLinkGraph(): Promise<LinkGraph> {
    return await invoke("get_link_graph");
}

/** The saved videos carrying a tag (any case), newest saved first. */
export async function listVideosWithTag(tag: string): Promise<MenuVideo[]> {
    return await invoke("list_videos_with_tag", { tag });
}

/** Puts a track back to the start date and run it had before its last Start over. */
export async function undoCalendarTrackStartOver(id: number): Promise<void> {
    await changeCalendar("undo_calendar_track_start_over", { id });
}

export async function removeCalendarEntry(id: number): Promise<void> {
    await changeCalendar("remove_calendar_entry", { id });
}

export async function setCalendarEntryOrder(trackId: number, entryIds: number[]): Promise<void> {
    await changeCalendar("set_calendar_entry_order", { trackId, entryIds });
}

/** Adds an empty folder to the end of a track: entries dragged into it share one place (one day, on a dated track). */
export async function addCalendarFolder(trackId: number, name: string): Promise<number> {
    return await changeCalendar("add_calendar_folder", { trackId, name });
}

/** Lays a track's entries out anew, as drag and drop leaves them: every entry in reading order, each with its folder. */
export async function setCalendarEntryLayout(trackId: number, layout: { id: number; folderId: number | null }[]): Promise<void> {
    await changeCalendar("set_calendar_entry_layout", { trackId, layout });
}

/** Marks an entry done (or not) in a loop cycle. A video in a Drive's sequence with no row yet is named by its video. */
export async function setCalendarCompletion(trackId: number, entry: Pick<CalendarEntry, 'id' | 'videoId'>, cycle: number, done: boolean): Promise<void> {
    await changeCalendar("set_calendar_completion", {
        trackId,
        entryId: entry.id > 0 ? entry.id : undefined,
        videoId: entry.id > 0 ? undefined : entry.videoId ?? undefined,
        cycle,
        done,
    });
}

/** Marks an entry In progress in a cycle, or takes the mark off. Only a marker: marking it done is what moves a track on
 *  (and clears this). Refused for an entry already done in that cycle. */
export async function setCalendarProgress(trackId: number, entry: Pick<CalendarEntry, 'id' | 'videoId'>, cycle: number, on: boolean): Promise<void> {
    await changeCalendar("set_calendar_progress", {
        trackId,
        entryId: entry.id > 0 ? entry.id : undefined,
        videoId: entry.id > 0 ? undefined : entry.videoId ?? undefined,
        cycle,
        on,
    });
}

export async function addCalendarTerm(trackId: number, term: { name: string; startDate: string; endDate: string; annual: boolean }): Promise<number> {
    return await changeCalendar("add_calendar_term", { trackId, ...term });
}

export async function removeCalendarTerm(id: number): Promise<void> {
    await changeCalendar("remove_calendar_term", { id });
}

export async function listCalendarHolidaySets(year?: number): Promise<CalendarHolidaySet[]> {
    return await invoke("list_calendar_holiday_sets", { year });
}

export async function createCalendarHolidaySet(name: string, annual: boolean): Promise<number> {
    return await changeCalendar("create_calendar_holiday_set", { name, annual });
}

export async function deleteCalendarHolidaySet(id: number): Promise<void> {
    await changeCalendar("delete_calendar_holiday_set", { id });
}

export async function addCalendarHolidayDate(setId: number, date: string, name?: string): Promise<void> {
    await changeCalendar("add_calendar_holiday_date", { setId, date, name });
}

export async function removeCalendarHolidayDate(setId: number, date: string): Promise<void> {
    await changeCalendar("remove_calendar_holiday_date", { setId, date });
}

/** Has a track exclude or include a holiday set; `null` for neither. */
export async function setCalendarTrackHolidayRule(trackId: number, setId: number, mode: 'exclude' | 'include' | null): Promise<void> {
    await changeCalendar("set_calendar_track_holiday_rule", { trackId, setId, mode });
}

/** A Drive that some of a channel's saved videos are filed under. */
export interface HandleDrive {
    /** Storage form, e.g. "θψCRYPTO_DOAC". */
    path: string;
    /** Display form, e.g. ":CRYPTO-DOAC". */
    display: string;
    /** The Drive's curated alias, when it has one that differs from its name. */
    alias: string | null;
    /** How many of the channel's videos are in it. */
    count: number;
}

/** One file attached to a video. Sizes are in bytes. */
export interface AttachmentInfo {
    id: number;
    name: string;
    ext: string;
    /** The original file's size. */
    size: number;
    /** What the database actually holds (smaller when the file was compressed). */
    storedSize: number;
    addedAt: string;
}

export interface VideoAttachments {
    note: string;
    attachments: AttachmentInfo[];
}

/** What happened to one file in `addAttachments`: it was added, or `error` says why not. */
export interface AddAttachmentOutcome {
    name: string;
    attachment: AttachmentInfo | null;
    error: string | null;
}

export async function getVideoAttachments(videoId: string): Promise<VideoAttachments> {
    return await invoke("get_video_attachments", { videoId });
}

export async function saveVideoNote(videoId: string, note: string): Promise<void> {
    await invoke("save_video_note", { videoId, note });
}

/** Native multi-file picker limited to the supported types. Empty when cancelled. */
export async function pickAttachmentFiles(): Promise<string[]> {
    return await invoke("pick_attachment_files");
}

/** Stores the files at `paths` (read by the backend) on the video, reporting each one's result. */
export async function addAttachments(videoId: string, paths: string[]): Promise<AddAttachmentOutcome[]> {
    return await invoke("add_attachments", { videoId, paths });
}

/** Adds a web link to a saved video, shown under `title` (the site's name when blank). It comes back as an
 *  attachment whose `ext` is "url". Only http and https addresses are accepted; the reason is thrown otherwise. */
export async function addAttachmentLink(videoId: string, title: string, url: string): Promise<AttachmentInfo> {
    return await invoke("add_attachment_link", { videoId, title, url });
}

/** Renames a link and/or changes its address after it was added. Validated exactly like a new one. */
export async function updateAttachmentLink(id: number, title: string, url: string): Promise<AttachmentInfo> {
    return await invoke("update_attachment_link", { id, title, url });
}

/** A link attachment's address, checked again on the way out. Shown to the user before it's opened. */
export async function getAttachmentLink(id: number): Promise<string> {
    return await invoke("get_attachment_link", { id });
}

export async function removeAttachment(id: number): Promise<void> {
    await invoke("remove_attachment", { id });
}

/** Drag-and-drop reordering in the Attachments panel. `orderedIds` is whichever tab (files or
 *  links) is currently showing — the other kind's order is untouched. */
export async function reorderAttachments(videoId: string, orderedIds: number[]): Promise<void> {
    await invoke("reorder_attachments", { videoId, orderedIds });
}

/** Opens the attachment in the system's default app. */
export async function openAttachment(id: number): Promise<void> {
    await invoke("open_attachment", { id });
}

/** Save As dialog; false when the user cancels. */
export async function saveAttachmentAs(id: number): Promise<boolean> {
    return await invoke("save_attachment_as", { id });
}

/** Curated aliases for the given Drive paths (storage form), keyed by path. Drives without an alias are left out. */
export async function getWdbsAliases(paths: string[]): Promise<Record<string, string>> {
    return await invoke("get_wdbs_aliases", { paths });
}

/** What the search box completes from: saved channels (handle without "@", and their name) and every saved video's ID and title. */
export async function getSearchSuggestions(): Promise<{ handles: { handle: string; name: string }[]; channels: { name: string; handle: string }[]; videos: { id: string; title: string }[] }> {
    return await invoke("get_search_suggestions");
}

/** Every channel's Drives at once: handle (lowercased, no "@") to the display paths of the Drives its saved videos are
 *  filed under (":MWD-JOHN"). For the Biography search bar's Drive facet. */
export async function getBiographyDrives(): Promise<Record<string, string[]>> {
    return await invoke("get_biography_drives");
}

/** Every Drive a channel's saved videos appear in (its category or an "Also in" link). */
export async function getHandleDrives(handle: string): Promise<HandleDrive[]> {
    return await invoke("get_handle_drives", { handle });
}

type RawBiographyEntry = {
    handle: string;
    display_name: string;
    bio: string;
    wikipedia: string;
    website: string;
    twitter: string;
    instagram: string;
    facebook: string;
    threads: string;
    youtube: string;
    tiktok: string;
    twitch: string;
    reddit: string;
    discord: string;
    alias?: string;
};

const mapBiography = (entry: RawBiographyEntry): BiographyEntry => ({
    handle: entry.handle,
    displayName: entry.display_name,
    bio: entry.bio,
    wikipedia: entry.wikipedia,
    website: entry.website,
    twitter: entry.twitter,
    instagram: entry.instagram,
    facebook: entry.facebook,
    threads: entry.threads,
    youtube: entry.youtube,
    tiktok: entry.tiktok,
    twitch: entry.twitch,
    reddit: entry.reddit,
    discord: entry.discord,
    alias: entry.alias ?? '',
});

export async function getBiographies(): Promise<BiographyEntry[]> {
    const rows = await invoke("get_biographies") as RawBiographyEntry[];
    return rows.map(mapBiography);
}

/** One text that links to something: a row of its Backlinks list (see src-tauri/src/db/links.rs's find_backlinks). */
export interface Backlink {
    /** Which text: a video's "summary", "transcript" or "note", a person's "bio", a term's "definition", or a note of the
     *  Notes section ("notePage", with its id as `key`). */
    source: 'summary' | 'transcript' | 'note' | 'bio' | 'definition' | 'notePage';
    /** The video the text belongs to (summary, transcript, note). */
    videoId: string | null;
    /** The person's handle (bio), the term (definition) or the note's id (notePage). */
    key: string | null;
    /** The video's title, the person's name, or the term. */
    title: string;
    /** The moments its links start at (timed video links), as written ("5:50"), each once. */
    times: string[];
    /** How many links in it point at the target. */
    links: number;
    /** The words around its first link to the target. */
    excerpt: string;
}

/** Every text that links to a video, person or other target. Scans the texts, so it takes a moment on a big library. */
export async function getBacklinks(kind: LinkKind, key: string): Promise<Backlink[]> {
    return await invoke("get_backlinks", { kind, key });
}

/** Links the creator's name in every older summary's "Channel Info:" footer to their biography (What's New, v0.5.1).
 *  Resolves to how many summaries changed. */
export async function linkChannelInfoFooters(): Promise<number> {
    return await invoke("link_channel_info_footers");
}

export async function getBiography(handle: string): Promise<BiographyEntry | null> {
    const row = await invoke("get_biography", { handle }) as RawBiographyEntry | null;
    return row ? mapBiography(row) : null;
}

/** What opening a biography found out from its channel's YouTube page (looked up by channel ID, no API key): the handle
 *  it goes by now (`renamedFrom` when that just changed, already carried over), and a name change waiting on the
 *  reader's say. */
export interface ChannelIdentityCheck {
    handle: string;
    renamedFrom: string | null;
    newDisplayName: string | null;
    oldDisplayName: string | null;
    /** The channel's subscriber count now, when it had changed since it was stored (already saved); null when not. */
    subscriberCount: number | null;
}

export async function checkChannelIdentity(handle: string): Promise<ChannelIdentityCheck> {
    const result = await invoke<ChannelIdentityCheck>("check_channel_identity", { handle });
    if (result.renamedFrom) window.dispatchEvent(new Event(BIOGRAPHY_CHANGED_EVENT));
    return result;
}

/** Edit Bio's Handle tab: the same handle in different capitals (@john to @John), never a different one. Rejects with
 *  the reason otherwise. Resolves to the handle as stored now. */
export async function setBiographyHandleCase(handle: string, newHandle: string): Promise<string> {
    const stored = await invoke<string>("set_biography_handle_case", { handle, newHandle });
    window.dispatchEvent(new Event(BIOGRAPHY_CHANGED_EVENT));
    return stored;
}

/** Takes a channel's new name, keeping the old one as its alias or not. */
export async function renameBiographyDisplayName(handle: string, name: string, keepOldAsAlias: boolean): Promise<void> {
    await invoke("rename_biography_display_name", { handle, name, keepOldAsAlias });
    window.dispatchEvent(new Event(BIOGRAPHY_CHANGED_EVENT));
}

/** A window event sent when a biography was edited here (its alias, say), so what shows it can reload. */
export const BIOGRAPHY_CHANGED_EVENT = 'kinesis-biography-changed';

export async function updateBiography(entry: BiographyEntry): Promise<void> {
    await invoke("update_biography", {
        handle: entry.handle,
        bio: entry.bio,
        wikipedia: entry.wikipedia,
        website: entry.website,
        twitter: entry.twitter,
        instagram: entry.instagram,
        facebook: entry.facebook,
        threads: entry.threads,
        youtube: entry.youtube,
        tiktok: entry.tiktok,
        twitch: entry.twitch,
        reddit: entry.reddit,
        discord: entry.discord,
        alias: entry.alias.trim(),
    });
    window.dispatchEvent(new Event(BIOGRAPHY_CHANGED_EVENT));
}

export async function openExternalUrl(url: string): Promise<void> {
    await openUrl(url);
}

export interface CustomPrompt {
    handle: string;
    localPromptText: string | null;
    cloudPromptText: string | null;
}

export async function getCustomPrompt(handle: string): Promise<[string | null, string | null]> {
    return await invoke("get_custom_prompt", { handle });
}

export async function getAllCustomPrompts(): Promise<CustomPrompt[]> {
    const prompts = await invoke("get_all_custom_prompts") as [string, string | null, string | null][];
    return prompts.map(([handle, localPromptText, cloudPromptText]) => ({
        handle,
        localPromptText,
        cloudPromptText,
    }));
}

export async function setCustomPrompt(handle: string, localPromptText: string | null, cloudPromptText: string | null): Promise<void> {
    await invoke("set_custom_prompt", { handle, localPromptText, cloudPromptText });
}

export async function deleteCustomPrompt(handle: string): Promise<void> {
    await invoke("delete_custom_prompt", { handle });
}

export async function getUniqueHandles(): Promise<string[]> {
    return await invoke("get_unique_handles");
}

/// Converts a video's stored WDBS value (storage encoding, e.g. "θψUAP_GERB_PND") into the
/// human-facing Warp Drive designator form (":UAP-GERB-PND") for display in an edit control.
/// Mirrors the encoding update_wdbs applies in reverse; returns '' for unassigned ("Universe").
export function decodeWdbs(stored: string | undefined | null): string {
    if (!stored || !stored.startsWith('θψ')) return '';
    const body = stored.slice(2);
    // A bare "θψ" with nothing after it (e.g. a production default-population trigger's
    // "no specific drive yet" sentinel) has no real designator to show — without this check
    // it would decode to a bare ":", which passed the caller's `|| "N/A"` fallback because ":"
    // is a non-empty, truthy string.
    if (!body) return '';
    return ':' + body.replace(/_/g, '-');
}

/// The inverse of decodeWdbs — mirrors the ':' -> 'θψ' / '-' -> '_' transform update_wdbs applies
/// server-side, so a caller that just successfully saved a display-format value (e.g.
/// Sidebar.tsx's handleSaveWdbs) can optimistically update local state without waiting on a
/// refetch. Returns '' for a blank/cleared input.
export function encodeWdbs(display: string): string {
    const trimmed = display.trim();
    if (!trimmed.startsWith(':') || trimmed.length < 2) return '';
    // Uppercased to mirror what commands::wdbs::encode_wdbs_display stores server-side, so this
    // optimistic local update matches what a refetch would actually return.
    return 'θψ' + trimmed.slice(1).toUpperCase().replace(/-/g, '_');
}

// Updates a video's canonical Warp Drive (the one shown by decodeWdbs(video.wdbs)), or clears it
// back to unassigned ("N/A") when `wdbs` is empty. To have the video additionally show up under
// OTHER Warp Drives without changing this one, see add/removeVideoWdbsLink below.
export async function updateVideoWdbs(videoId: string, wdbs: string): Promise<void> {
    await invoke("update_wdbs", { videoId, wdbs });
}

// One node of the Warp Drive taxonomy tree (see components/WdbsTreePanel.tsx). `path` is the
// storage-encoded prefix to pass to getVideosByWdbs; `count` includes every distinct video at
// this node and everywhere beneath it (canonical assignment or symlink — see
// add/removeVideoWdbsLink). The tree itself never contains an unassigned/"Unsorted" node — that's
// a synthetic entry the panel renders on top, backed by getUnsortedVideos/UNSORTED_WDBS_FILTER,
// since it isn't a real taxonomy node and a video's assignment to it isn't something to alias/
// icon-edit the way a real one is.
export interface WdbsNode {
    segment: string;
    path: string;
    count: number;
    children: WdbsNode[];
    // The node's curated display alias (tblWDBS.WDInfo), when one's been set and differs from
    // `segment` — null both when nothing's been curated and when the database doesn't have the
    // production tblWDBS schema at all. See setWdbsAlias.
    alias: string | null;
    // The node's curated icon (tblWDBS.WDIcon) — one of WDBS_ICON_KEYS, or null when unset/
    // unrecognized/no tblWDBS. See setWdbsIcon.
    icon: string | null;
    // The node's curated color decoration (tblWDBS.WDColor) — one of WDBS_COLOR_KEYS, or null when
    // unset/unrecognized/no tblWDBS. See setWdbsColor. Rendered as a small colored chip before the
    // node's icon; which exact shade that resolves to is picked client-side (lib/wdbs-colors.ts),
    // not carried in this value.
    color: string | null;
    // The color decoration's container shape (tblWDBS.WDShape) — one of WDBS_SHAPE_KEYS, or null
    // when unset/unrecognized/no tblWDBS. See setWdbsShape. `null` renders the same as "square" —
    // the original/default look — see lib/wdbs-shapes.tsx.
    shape: string | null;
}

// The fixed set of icons a Warp Drive taxonomy node's WDIcon can hold — must match the Rust side's
// db::WDBS_ICONS exactly (that's what commands::wdbs::set_wdbs_icon validates against). Order here
// is just the order they're offered in WdbsIconMenu's picker. No "star" — see db::WDBS_ICONS's own
// comment for why it moved to the color decoration's shapes instead.
export const WDBS_ICON_KEYS = [
    "company", "person", "music", "sports", "gaming", "podcast", "fitness", "food",
    "news", "education", "comedy", "tech", "finance", "guides",
    "health", "privacy", "repair", "coding", "art", "reading", "project", "ai",
] as const;
export type WdbsIconKey = typeof WDBS_ICON_KEYS[number];

// The fixed set of color decorations a Warp Drive taxonomy node's WDColor can hold — must match
// the Rust side's db::WDBS_COLORS exactly (that's what commands::wdbs::set_wdbs_color validates
// against). Order here is the order they're offered in WdbsColorMenu's picker.
export const WDBS_COLOR_KEYS = [
    "red", "yellow", "green", "aqua", "magenta", "slate_gray", "charcoal",
] as const;
export type WdbsColorKey = typeof WDBS_COLOR_KEYS[number];

// The fixed set of container shapes a color decoration can use — must match the Rust side's
// db::WDBS_SHAPES exactly (that's what commands::wdbs::set_wdbs_shape validates against). "square"
// is the original/default look; order here is the order offered in WdbsColorMenu's "Shape" row.
export const WDBS_SHAPE_KEYS = ["square", "circle", "star", "diamond", "heart"] as const;
export type WdbsShapeKey = typeof WDBS_SHAPE_KEYS[number];

export async function getWdbsTree(): Promise<WdbsNode[]> {
    return await invoke("get_wdbs_tree");
}

// Sets (or clears, given '') the curated display alias for one Warp Drive taxonomy node — shown
// as a tooltip/detail alongside its raw segment name (see components/WdbsTreePanel.tsx's "Edit
// Alias" context menu). `path` is a WdbsNode.path value. A no-op against a database without the
// production tblWDBS schema.
export async function setWdbsAlias(path: string, alias: string): Promise<void> {
    await invoke("set_wdbs_alias", { path, alias });
}

// Sets (or clears, given '') the curated icon for one Warp Drive taxonomy node — shown to the left
// of its segment name in the tree (see components/WdbsTreePanel.tsx's "Edit Icon" context menu).
// `path` is a WdbsNode.path value; `icon` must be one of WDBS_ICON_KEYS or ''. A no-op against a
// database without the production tblWDBS schema.
export async function setWdbsIcon(path: string, icon: string): Promise<void> {
    await invoke("set_wdbs_icon", { path, icon });
}

// Sets (or clears, given '') the curated color decoration for one Warp Drive taxonomy node —
// shown as a small colored chip before its icon in the tree (see
// components/WdbsTreePanel.tsx's "Edit Color Decoration" context menu). `path` is a WdbsNode.path
// value; `color` must be one of WDBS_COLOR_KEYS or ''. Independent of setWdbsShape — clearing or
// changing one never touches the other. A no-op against a database without the production
// tblWDBS schema.
export async function setWdbsColor(path: string, color: string): Promise<void> {
    await invoke("set_wdbs_color", { path, color });
}

// Sets (or clears, given '') the color decoration's container shape for one Warp Drive taxonomy
// node — which of WdbsColorMenu's "Shape" row options (square/circle/star/diamond) the chip above
// is drawn as. `path` is a WdbsNode.path value; `shape` must be one of WDBS_SHAPE_KEYS or ''. A
// no-op against a database without the production tblWDBS schema.
export async function setWdbsShape(path: string, shape: string): Promise<void> {
    await invoke("set_wdbs_shape", { path, shape });
}

// `wdbsPath` is a WdbsNode.path value (or any encoded prefix) — selects that category and
// everything nested beneath it.
// `query` narrows the category's videos via the same FTS5 search the Library/Portal grid's own
// search box uses, just scoped to this category instead of the whole library — pass '' for none.
export async function getVideosByWdbs(wdbsPath: string, query: string, opts?: LibraryQueryOptions): Promise<SearchResponse> {
    return await invoke("fetch_videos_by_wdbs", {
        wdbsPrefix: wdbsPath,
        query,
        filterKind: opts?.filterKind,
        sortField: opts?.sortField,
        sortOrder: opts?.sortOrder,
        limit: opts?.limit,
        offset: opts?.offset,
    });
}

// A synthetic wdbsFilter value — never a real storage-encoded path (those always start with
// "θψ") — meaning "videos with no home Warp Drive at all". See WdbsTreePanel's Unsorted entry and
// getUnsortedVideos below; hooks/useLibrary.ts branches on this instead of sending it to the backend.
export const UNSORTED_WDBS_FILTER = '__UNSORTED__';

// Every video with no home Warp Drive (WDBS empty, ':', or the raw production placeholder) — the
// Drive tree's synthetic "Unsorted" entry, not a real taxonomy node. `query` narrows within it the
// same way getVideosByWdbs's does.
export async function getUnsortedVideos(query: string, opts?: LibraryQueryOptions): Promise<SearchResponse> {
    return await invoke("fetch_unsorted_videos", {
        query,
        filterKind: opts?.filterKind,
        sortField: opts?.sortField,
        sortOrder: opts?.sortOrder,
        limit: opts?.limit,
        offset: opts?.offset,
    });
}

// How many videos are currently Unsorted — the tree entry's count badge.
export async function getUnsortedVideoCount(): Promise<number> {
    return await invoke("get_unsorted_video_count");
}

// Every Warp Drive path currently assigned to at least one video (storage-encoded) — decode with
// decodeWdbs() before showing as autocomplete suggestions in a Warp Drive editor.
export async function getWdbsSuggestions(): Promise<string[]> {
    return await invoke("get_wdbs_suggestions");
}

// A video's current canonical Warp Drive (WDBS), storage-encoded — null if unassigned or if the
// video isn't saved locally. A Video object opened from Search comes straight from the YouTube
// API and never carries its own `wdbs` field, even if that video is already saved with one, so
// Sidebar.tsx looks this up once it confirms the video exists in the database.
export async function getVideoWdbs(videoId: string): Promise<string | null> {
    return await invoke("get_video_wdbs", { videoId });
}

// A video's symlinked (non-canonical) Warp Drives, storage-encoded.
export async function getVideoWdbsLinks(videoId: string): Promise<string[]> {
    return await invoke("get_video_wdbs_links", { videoId });
}

// Links a video to an additional Warp Drive (":UAP-GERB-VVV" display format) without touching
// its canonical one. Resolves to the storage-encoded value that was added.
export async function addVideoWdbsLink(videoId: string, wdbs: string): Promise<string> {
    return await invoke("add_video_wdbs_link", { videoId, wdbs });
}

// `wdbs` must be the storage-encoded value (as returned by addVideoWdbsLink/getVideoWdbsLinks),
// not the ":..." display form.
export async function removeVideoWdbsLink(videoId: string, wdbs: string): Promise<void> {
    await invoke("remove_video_wdbs_link", { videoId, wdbs });
}

export interface BulkWdbsResult {
    succeeded: string[];
    // [videoId, errorMessage] pairs — one bad video can't abort the whole batch, so a partial
    // result is reported instead of an all-or-nothing failure.
    failed: [string, string][];
}

// Assigns every video in `videoIds` to `wdbs` (display format, ":UAP-GERB-VVV") in one round
// trip, or clears them all back to unassigned when `wdbs` is empty — see App.tsx's Bulk Assign
// Mode in the Library/Portal grid.
export async function bulkUpdateVideoWdbs(videoIds: string[], wdbs: string): Promise<BulkWdbsResult> {
    return await invoke("bulk_update_wdbs", { videoIds, wdbs });
}

// ─── Manage Drive ────────────────────────────────────────────────────────────
// The Manage Drive window (components/drive-manager): every Drive, empty ones included, and changing the
// Drive's shape. See src-tauri/src/db/drive_manage.rs.

/** One node of the Manage Drive tree. */
export interface ManageNode {
    segment: string;
    /** Display form, ":CS-DSA". */
    display: string;
    /** Storage form, "θψCS_DSA" (what the Library's Drive filter and the alias/marker setters take). */
    path: string;
    alias: string | null;
    icon: string | null;
    color: string | null;
    shape: string | null;
    /** Videos whose home is exactly this Drive. */
    filed: number;
    /** "Also in" links to exactly this Drive. */
    linked: number;
    /** Distinct videos here or beneath. */
    total: number;
    /** Videos in this Drive's own sequence. */
    sequence: number;
    /** Glossary entries filed under it (top-level Drives only). */
    terms: number;
    children: ManageNode[];
}

export async function getDriveManageTree(): Promise<ManageNode[]> {
    return await invoke("get_drive_manage_tree");
}

export interface SequenceSummary {
    /** Display form. */
    drive: string;
    count: number;
    /** Entries whose video has left the Drive. */
    stale: number;
    /** The video first in the sequence right now (what a sequence link opens), and its title. */
    firstVideoId: string | null;
    firstTitle: string | null;
}

/** Fired (on window) when a sequence is made, reordered or emptied, so a list of them that's on screen (the Library's
 *  Drive panel) can read them again. */
export const SEQUENCES_CHANGED_EVENT = 'kinesis:sequences-changed';

export async function listDriveSequences(): Promise<SequenceSummary[]> {
    return await invoke("list_drive_sequences");
}

/** One Drive's sequence (display path), or null when it has none. */
export async function getSequenceSummary(drive: string): Promise<SequenceSummary | null> {
    return await invoke("get_sequence_summary", { drive });
}

/** A video's thumbnail, from its id alone (the same address the backend gives saved videos). It's 4:3, with black bars
 *  above and below a 16:9 video: a box that isn't 16:9 trims them with TRIMMED_THUMB_IMG (components/SequenceCard.tsx). */
export function videoThumbnail(videoId: string): string {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** A video filed at a Drive: one row per home or "Also in" link. */
export interface DriveMember {
    videoId: string;
    title: string;
    author: string | null;
    handle: string | null;
    /** Where this row files it (display form). */
    at: string;
    viaLink: boolean;
    /** The video's home (display form), for a linked row. */
    home: string | null;
}

export async function listDriveMembers(drive: string, includeSub: boolean): Promise<DriveMember[]> {
    return await invoke("list_drive_members", { drive, includeSub });
}

/** Adds a Drive under `parent` (display form), or at the top level. Returns its display path. */
export async function createDrive(parent: string | null, name: string): Promise<string> {
    return await invoke("create_drive", { parent, name });
}

/** What a rename/move/merge did, or (dry run) would do. */
export interface RelocateReport {
    from: string;
    to: string;
    merged: boolean;
    drives: number;
    videos: number;
    links: number;
    sequences: number;
    terms: number;
    /** Notes refiled (the Notes section). */
    notes: number;
    texts: number;
}

/** Renames, moves or merges a Drive (display paths). `dryRun` reports without changing anything. */
export async function relocateDrive(from: string, to: string, dryRun: boolean): Promise<RelocateReport> {
    return await invoke("relocate_drive", { from, to, dryRun });
}

export interface DeleteDriveReport {
    drive: string;
    drives: number;
    texts: number;
}

/** Deletes an empty Drive and everything beneath it. Rejects, saying what's left, when it isn't empty. */
export async function deleteDrive(drive: string, dryRun: boolean): Promise<DeleteDriveReport> {
    return await invoke("delete_drive", { drive, dryRun });
}

export interface PixabayImage {
    id: number;
    url: string;
    thumbnail: string;
    width: number;
    height: number;
    tags: string;
}

export async function searchPixabay(query: string): Promise<PixabayImage[]> {
    return await invoke("search_pixabay", { query });
}

export async function uploadToImgur(imageUrl: string): Promise<string> {
    return await invoke("upload_to_imgur", { imageUrl });
}

export async function getPixabayApiKey(): Promise<string | null> {
    return await invoke("get_pixabay_api_key");
}

export async function setPixabayApiKey(key: string): Promise<void> {
    await invoke("set_pixabay_api_key", { apiKey: key });
}

export async function generateImage(prompt: string): Promise<string> {
    return await invoke("generate_image", { prompt });
}

export async function fetchImageAsDataUri(url: string): Promise<string> {
    return await invoke("fetch_image_as_data_uri", { url });
}

export async function saveImage(path: string, contentsBase64: string): Promise<void> {
    await invoke("save_image", { path, contentsBase64 });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncManifest {
    server_name: string;
    protocol_version: number;
    min_client_version: string;
    pack_version: number;
    revision: number;
    retention_revision: number;
    capabilities: { content: boolean; policy: boolean; license: string[] };
    license_mode: string;
}

export interface LicenseInfo {
    /** Providers reachable through the server's proxy: "venice", "youtube", "pixabay". */
    providers: string[];
    /** "fallback" (the user's own key wins) or "enforce" (always use the proxy). */
    mode: string;
}

export interface SyncStatus {
    connected: boolean;
    running: boolean;
    server_url: string;
    server_name: string;
    has_token: boolean;
    last_sync_at: string;
    last_error: string;
    cursor: number;
    auto_sync: boolean;
    interval_minutes: number;
    owned_counts: Record<string, number>;
    locked_settings: string[];
    license: LicenseInfo;
}

export interface SyncReport {
    full: boolean;
    cancelled: boolean;
    revision: number;
    pages: number;
    upserted: number;
    unchanged: number;
    deleted: number;
    disowned: number;
    skipped: number;
    error_count: number;
    errors: string[];
    policy_applied: number;
    policy_dropped: number;
}

export interface SyncProgress {
    phase: "connecting" | "applying" | "policy" | "done";
    message: string;
    page: number;
    upserted: number;
    deleted: number;
}

export interface SyncDisconnectResult {
    upserted: number;
    unchanged: number;
    deleted: number;
    disowned: number;
    skipped: number;
    errors: string[];
}

export async function syncTest(url: string, token: string): Promise<SyncManifest> {
    return await invoke("sync_test", { url, token });
}

export async function syncConnect(url: string, token: string): Promise<SyncManifest> {
    return await invoke("sync_connect", { url, token });
}

export async function syncRun(forceFull: boolean): Promise<SyncReport> {
    return await invoke("sync_run", { forceFull });
}

export async function syncCancel(): Promise<void> {
    await invoke("sync_cancel");
}

export async function getSyncStatus(): Promise<SyncStatus> {
    return await invoke("sync_status");
}

export async function syncSetOptions(autoSync: boolean, intervalMinutes: number): Promise<void> {
    await invoke("sync_set_options", { autoSync, intervalMinutes });
}

export async function syncDisconnect(keepData: boolean): Promise<SyncDisconnectResult> {
    return await invoke("sync_disconnect", { keepData });
}

/** Setting keys the connected sync server locks against local edits. */
export async function getLockedSettings(): Promise<string[]> {
    return await invoke("get_locked_settings");
}

export interface ProviderStatus {
    /** The user has their own key stored. */
    own_key: boolean;
    /** The connected sync server offers a license for this provider. */
    licensed: boolean;
    /** A call would work right now (own key or license). */
    available: boolean;
    /** The license, not the user's own key, is what a call would use. */
    via_license: boolean;
}

export interface KeyStatus {
    server_name: string;
    youtube: ProviderStatus;
    venice: ProviderStatus;
    pixabay: ProviderStatus;
}

/** Whether each provider is reachable, by the user's own key or by a sync-server license. */
export async function getKeyStatus(): Promise<KeyStatus> {
    return await invoke("get_key_status");
}

// ─── Workspaces and kinpaks ──────────────────────────────────────────────────

export interface WorkspaceInfo {
    /** Folder name under the app data folder: the workspace's identity for open / remove / locate. */
    folder: string;
    name: string;
    /** Where the data actually lives. */
    path: string;
    dbPath: string;
    /** False when the database can't be found (an unplugged drive, a moved folder). */
    available: boolean;
    redirected: boolean;
    lastOpened: number;
    current: boolean;
}

export interface WorkspaceStatus {
    current: WorkspaceInfo | null;
    /** Why nothing was opened at startup. */
    notice: string | null;
    recents: WorkspaceInfo[];
    defaultLocation: string;
}

// The backend serializes WorkspaceInfo with snake_case field names; map them once here.
interface RawWorkspaceInfo {
    folder: string; name: string; path: string; db_path: string; available: boolean;
    redirected: boolean; last_opened: number; current: boolean;
}
const toWorkspace = (w: RawWorkspaceInfo): WorkspaceInfo => ({
    folder: w.folder, name: w.name, path: w.path, dbPath: w.db_path, available: w.available,
    redirected: w.redirected, lastOpened: w.last_opened, current: w.current,
});

export async function getWorkspaceStatus(): Promise<WorkspaceStatus> {
    const s = await invoke<{ current: RawWorkspaceInfo | null; notice: string | null; recents: RawWorkspaceInfo[]; defaultLocation: string }>("get_workspace_status");
    return { ...s, current: s.current ? toWorkspace(s.current) : null, recents: s.recents.map(toWorkspace) };
}

export interface NameCheck {
    ok: boolean;
    /** A workspace with this name already exists. */
    taken: boolean;
    error: string | null;
    name: string;
    suggestion: string;
}

export async function checkWorkspaceName(name: string): Promise<NameCheck> {
    return await invoke("check_workspace_name", { name });
}

/** Creates a workspace and opens it. `location` keeps its data in `<location>/<name>` instead of the app folder. */
export async function createWorkspace(name: string, location?: string | null): Promise<WorkspaceInfo> {
    return toWorkspace(await invoke("create_workspace", { name, location: location ?? null }));
}

export async function openWorkspace(folder: string): Promise<WorkspaceInfo> {
    return toWorkspace(await invoke("open_workspace", { folder }));
}

/** Adds a folder holding a kinesis_data.db to the list (once) and opens it. */
export async function openExistingWorkspace(path: string): Promise<WorkspaceInfo> {
    return toWorkspace(await invoke("open_existing_workspace", { path }));
}

/** Removes a workspace from the list. Its data is never deleted. */
export async function forgetWorkspace(folder: string): Promise<void> {
    await invoke("forget_workspace", { folder });
}

/** Points a workspace whose database went missing at its new folder. */
export async function relocateWorkspace(folder: string, path: string): Promise<WorkspaceInfo> {
    return toWorkspace(await invoke("relocate_workspace", { folder, path }));
}

export async function revealWorkspace(folder: string): Promise<void> {
    await invoke("reveal_workspace", { folder });
}

export interface KinpakOptions {
    taxonomy: boolean;
    videos: boolean;
    transcripts: boolean;
    glossary: boolean;
    biographies: boolean;
    prompts: boolean;
    /** Per-Drive sequence membership and ordering. */
    sequences: boolean;
    settings: boolean;
    /** The workspace's name and its section aliases. */
    workspace: boolean;
    history: boolean;
    notes: boolean;
    attachments: boolean;
    /** The Calendar's tracks, with their entries, terms and holiday rules. */
    calendar: boolean;
    /** With the tracks, what's been checked off (off: they arrive as a fresh plan). */
    calendarProgress: boolean;
    /** The shared notes of the Notes section (personal notes never go in). */
    studyNotes: boolean;
    drives: DriveScopeOptions;
}

export interface KinpakExportSummary {
    path: string;
    counts: Record<string, number>;
    settings: number;
    bytes: number;
}

export interface KinpakImportSummary {
    pack_app: string;
    pack_generated_at: string;
    imported: number;
    skipped: number;
    error_count: number;
    errors: string[];
    settings_applied: number;
    settings_skipped: number;
    counts: Record<string, number>;
    /** Left out on purpose, in words (a Calendar track whose name the workspace already has): not errors. */
    notices: string[];
}

export interface KinpakPreview {
    app: string;
    generatedAt: string;
    workspaceName: string | null;
    counts: Record<string, number>;
    /** The name to offer: the pack's own, cleaned up. */
    suggestedName: string;
    /** A workspace already has that name, so importing would add to it. */
    nameTaken: boolean;
}

/** Writes the kinpak to `filePath` (from the Save As dialog); the name always ends in .kinpak. */
export async function exportKinpak(filePath: string, options: KinpakOptions): Promise<KinpakExportSummary> {
    return await invoke("export_kinpak", { filePath, options });
}

/** The Save As dialog for a kinpak; null if cancelled. */
export async function selectKinpakSavePath(defaultName: string, startDir?: string | null): Promise<string | null> {
    return await invoke("select_kinpak_save_path", { defaultName, startDir: startDir ?? null });
}

export async function selectKinpakFile(): Promise<string | null> {
    return await invoke("select_kinpak_file");
}

/** What a kinpak is and where it came from, without reading the whole file. */
export async function inspectKinpak(filePath: string): Promise<KinpakPreview> {
    return await invoke("inspect_kinpak", { filePath });
}

export interface ImportedWorkspace {
    workspace: WorkspaceInfo;
    summary: KinpakImportSummary;
    /** Added to a workspace that already had that name, rather than made into a new one. */
    merged: boolean;
}

/**
 * Imports a kinpak under `name`. A workspace with that name gets what it's missing added (nothing it
 * has is replaced or removed); any other name makes a new workspace, stored in `location` if given.
 */
export async function importKinpak(filePath: string, name: string, open: boolean, location?: string | null): Promise<ImportedWorkspace> {
    const r = await invoke<{ workspace: RawWorkspaceInfo; summary: KinpakImportSummary; merged: boolean }>("import_kinpak", {
        filePath, name, open, location: location ?? null,
    });
    return { workspace: toWorkspace(r.workspace), summary: r.summary, merged: r.merged };
}

// ─── Tray (Windows) ──────────────────────────────────────────────────────────
// The tray icon and its quick-save popup (src/components/QuickAdd.tsx). Other platforms have neither.

/** Whether this platform has the tray icon and popup. */
export async function traySupported(): Promise<boolean> {
    return await invoke("tray_supported");
}

/** "Keep running in the tray": closing the main window hides it instead of quitting. */
export async function getCloseToTray(): Promise<boolean> {
    return await invoke("get_close_to_tray");
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
    await invoke("set_close_to_tray", { enabled });
}

/** The text on the clipboard, if there is any. */
export async function readClipboardText(): Promise<string | null> {
    return await invoke("read_clipboard_text");
}

export async function hideQuickAdd(): Promise<void> {
    await invoke("hide_quick_add");
}

/** Brings the main window to the front (from the popup): out of the tray, restored, or just focused. */
export async function showMainWindow(): Promise<void> {
    await invoke("show_main_window");
}

/** Shows the window's system menu (Restore, Move, Size, Minimize, Maximize, Close) at the pointer, where the platform
 *  has one (Windows). False if it didn't, so the caller draws its own. */
export async function showSystemMenu(): Promise<boolean> {
    return invoke<boolean>("show_system_menu");
}
