use serde::{Deserialize, Serialize};
use tauri::command;
use std::path::PathBuf;
use tauri::Manager;
use serde_json::Value;

mod db;
mod youtube;

use youtube::{YouTubeClient, ClientType};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    #[serde(rename = "publishedAt")]
    pub published_at: String,
    #[serde(rename = "viewCount")]
    pub view_count: String,
    pub author: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelInfo {
    #[serde(rename = "channelId")]
    channel_id: String,
    #[serde(rename = "channelName")]
    channel_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoResponse {
    videos: Vec<Video>,
    continuation: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DisplaySettings {
    pub resolution: String,
    pub fullscreen: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbDetails {
    pub path: String,
    pub size_bytes: u64,
    pub video_count: i64,
}

fn get_db_path(app: &tauri::AppHandle) -> String {
    let path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }
    let db_file_path = path.join("kinesis_data.db").to_string_lossy().to_string();
    let _ = db::init_db(&db_file_path);
    db_file_path
}

#[command]
fn get_api_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db_path = get_db_path(&app);
    db::get_setting(&db_path, "api_key").map_err(|e| e.to_string())
}

#[command]
fn set_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::set_setting(&db_path, "api_key", &api_key).map_err(|e| e.to_string())
}

#[command]
fn remove_api_key(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::delete_setting(&db_path, "api_key").map_err(|e| e.to_string())
}

#[command]
fn open_db_location(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = get_db_path(&app);
    if let Some(dir) = PathBuf::from(&db_path).parent() {
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("explorer").arg(dir).spawn();
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(dir).spawn();
        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }
    Ok(())
}

#[command]
fn get_db_details(app: tauri::AppHandle) -> Result<DbDetails, String> {
    let path = get_db_path(&app);
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let video_count = db::get_db_stats(&path).map_err(|e| e.to_string())?;
    
    Ok(DbDetails {
        path,
        size_bytes,
        video_count,
    })
}

#[command]
fn get_display_settings(app: tauri::AppHandle) -> Result<DisplaySettings, String> {
    let db_path = get_db_path(&app);
    let resolution = db::get_setting(&db_path, "resolution")
        .unwrap_or(None)
        .unwrap_or_else(|| "1440x900".to_string());
    let fullscreen = db::get_setting(&db_path, "fullscreen")
        .unwrap_or(None)
        .map(|s| s == "true")
        .unwrap_or(false);
        
    Ok(DisplaySettings {
        resolution,
        fullscreen,
    })
}

#[command]
fn set_display_settings(app: tauri::AppHandle, settings: DisplaySettings) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::set_setting(&db_path, "resolution", &settings.resolution).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "fullscreen", &settings.fullscreen.to_string()).map_err(|e| e.to_string())?;
    
    // Apply immediately if possible
    if let Some(window) = app.get_webview_window("main") {
        let parts: Vec<&str> = settings.resolution.split('x').collect();
        if parts.len() == 2 {
            if let (Ok(w), Ok(h)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
            }
        }
        let _ = window.set_fullscreen(settings.fullscreen);
    }
    
    Ok(())
}

#[command]
async fn resolve_channel(_app: tauri::AppHandle, query: String) -> Result<ChannelInfo, String> {
    let cid = youtube::extract_channel_id(&query).await?;
    match cid {
        Some(id) => Ok(ChannelInfo {
            channel_id: id,
            channel_name: query,
        }),
        None => Err("Could not resolve channel.".to_string()),
    }
}

#[command]
async fn fetch_videos(
    _app: tauri::AppHandle,
    id: String,
    is_playlist: bool,
    continuation: Option<String>,
) -> Result<VideoResponse, String> {
    let client = YouTubeClient::new(ClientType::Web);
    let playlist_id = if is_playlist {
        youtube::extract_playlist_id(&id)
    } else {
        let channel_id = youtube::extract_channel_id(&id).await?.ok_or("Channel not found")?;
        youtube::channel_id_to_uploads_playlist(&channel_id)
    };
    
    let browse_id = if playlist_id.starts_with("VL") { playlist_id } else { format!("VL{}", playlist_id) };

    let data = client.browse(Some(browse_id), continuation).await?;
    let mut videos = Vec::new();

    // Parse initial browse data
    if let Some(tabs) = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"].as_array() {
        if let Some(contents) = tabs[0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array() {
            if let Some(items) = contents[0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"].as_array() {
                for item in items {
                    if let Some(v_renderer) = item.get("playlistVideoRenderer") {
                        if let Some(v_json) = youtube::extract_playlist_video_info(v_renderer) {
                            if let Ok(mut v) = serde_json::from_value::<Video>(v_json) {
                                v.date_added = None;
                                videos.push(v);
                            }
                        }
                    }
                }
            }
        }
    }

    // Parse continuation data
    if let Some(actions) = data["onResponseReceivedActions"].as_array() {
        if let Some(items) = actions[0]["appendContinuationItemsAction"]["continuationItems"].as_array() {
             for item in items {
                if let Some(v_renderer) = item.get("playlistVideoRenderer") {
                    if let Some(v_json) = youtube::extract_playlist_video_info(v_renderer) {
                        if let Ok(mut v) = serde_json::from_value::<Video>(v_json) {
                            v.date_added = None;
                            videos.push(v);
                        }
                    }
                }
            }
        }
    }

    Ok(VideoResponse {
        videos,
        continuation: None,
    })
}

#[command]
async fn fetch_channel_videos_v3(
    app: tauri::AppHandle,
    query: String,
    continuation: Option<String>,
) -> Result<VideoResponse, String> {
    let db_path = get_db_path(&app);
    let api_key = db::get_setting(&db_path, "api_key").unwrap_or(None).ok_or("API Key not found")?;

    let channel_id = youtube::extract_channel_id(&query).await?.unwrap_or(query);
    let client = reqwest::Client::new();

    // 1. Try to get the "Uploads" playlist ID (Usually UC -> UU)
    let uploads_playlist_id = if channel_id.starts_with("UC") {
        format!("UU{}", &channel_id[2..])
    } else {
        channel_id.clone()
    };

    // 2. Try the playlistItems endpoint first (supports full history, is more consistent)
    let mut url = format!("https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId={}&key={}", uploads_playlist_id, api_key);
    if let Some(token) = continuation.as_ref() {
        url = format!("{}&pageToken={}", url, token);
    }

    let mut res: Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

    // If playlistItems failed with a 404 or something, fallback to the Search API
    if res.get("error").is_some() {
        let mut search_url = format!("https://youtube.googleapis.com/youtube/v3/search?part=snippet&maxResults=50&channelId={}&order=date&type=video&key={}", channel_id, api_key);
        if let Some(token) = continuation {
            search_url = format!("{}&pageToken={}", search_url, token);
        }
        res = client.get(&search_url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        
        if res.get("error").is_some() {
            return Err(format!("API Error: {}", res["error"]["message"].as_str().unwrap_or("Unknown")));
        }
    }

    let next_page_token = res["nextPageToken"].as_str().map(|s| s.to_string());
    let mut videos = Vec::new();
    let mut video_ids = Vec::new();

    if let Some(items) = res["items"].as_array() {
        for item in items {
            let snippet = &item["snippet"];
            // playlistItems has videoId in contentDetails, search has it in id
            let vid = item["contentDetails"]["videoId"].as_str()
                .or_else(|| item["id"]["videoId"].as_str())
                .or_else(|| item["id"].as_str());

            if let Some(vid) = vid {
                video_ids.push(vid.to_string());
                videos.push(Video {
                    id: vid.to_string(),
                    title: snippet["title"].as_str().unwrap_or("Unknown").to_string(),
                    thumbnail: snippet["thumbnails"]["high"]["url"].as_str().or(snippet["thumbnails"]["default"]["url"].as_str()).unwrap_or("").to_string(),
                    published_at: snippet["publishedAt"].as_str().unwrap_or("").to_string(),
                    view_count: "0".to_string(),
                    author: snippet["channelTitle"].as_str().map(|s| s.to_string()),
                    status: None,
                    date_added: None,
                });
            }
        }
    }

    if !video_ids.is_empty() {
        let stats_url = format!("https://youtube.googleapis.com/youtube/v3/videos?part=statistics&id={}&key={}", video_ids.join(","), api_key);
        if let Ok(stats_res) = client.get(&stats_url).send().await {
            if let Ok(stats_data) = stats_res.json::<Value>().await {
                if let Some(items) = stats_data["items"].as_array() {
                    for item in items {
                        if let Some(vid) = item["id"].as_str() {
                            if let Some(v) = videos.iter_mut().find(|v| v.id == vid) {
                                let vc = item["statistics"]["viewCount"].as_str().unwrap_or("0");
                                v.view_count = vc.to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(VideoResponse {
        videos,
        continuation: next_page_token,
    })
}

#[command]
async fn fetch_view_count(_app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let client = YouTubeClient::new(ClientType::Web);
    let data = client.player(&video_id).await?;
    Ok(data["videoDetails"]["viewCount"].as_str().unwrap_or("0").to_string())
}

#[command]
async fn fetch_video_info(_app: tauri::AppHandle, video_id: String) -> Result<Video, String> {
    let client = YouTubeClient::new(ClientType::Web);
    let data = client.player(&video_id).await?;
    let details = &data["videoDetails"];
    
    let published_at = data["microformat"]["playerMicroformatRenderer"]["publishDate"].as_str().unwrap_or("").to_string();
    
    Ok(Video {
        id: details["videoId"].as_str().unwrap_or(&video_id).to_string(),
        title: details["title"].as_str().unwrap_or("Unknown").to_string(),
        thumbnail: details["thumbnail"]["thumbnails"].as_array().and_then(|a| a.last()).and_then(|t| t["url"].as_str()).unwrap_or("").to_string(),
        published_at,
        view_count: details["viewCount"].as_str().unwrap_or("0").to_string(),
        author: details["author"].as_str().map(|s| s.to_string()),
        status: None,
        date_added: None,
    })
}

#[command]
async fn fetch_transcript(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    if let Ok(Some(transcript)) = db::get_transcript(&db_path, &video_id) {
        return Ok(transcript);
    }

    // Fallback: check if API key exists. "else, don't fetch transcript at all"
    let api_key = db::get_setting(&db_path, "api_key").unwrap_or(None);
    if api_key.is_none() || api_key.unwrap().trim().is_empty() {
        return Err("API_KEY_MISSING".to_string());
    }

    let client = YouTubeClient::new(ClientType::Android);
    
    let mut attempts = 0;
    loop {
        attempts += 1;
        let player_json = client.player(&video_id).await?;
        match youtube::fetch_transcript(&player_json).await {
            Ok(Some(t)) if !t.trim().is_empty() => return Ok(t),
            Ok(_) | Err(_) if attempts < 3 => {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }
            Ok(_) => return Err("No transcript available".to_string()),
            Err(e) => return Err(e),
        }
    }
}

#[command]
async fn save_video(app: tauri::AppHandle, video_id: String) -> Result<Video, String> {
    let db_path = get_db_path(&app);
    
    // 1. Check if exists
    if let Ok(Some(v_data)) = db::get_video_full(&db_path, &video_id) {
        return Ok(Video {
            id: v_data.0,
            title: v_data.1,
            thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
            published_at: v_data.6,
            view_count: v_data.5,
            author: Some(v_data.2),
            status: Some("exists".to_string()),
            date_added: None, // Or we could put the actual date added here, but check exists works enough.
        });
    }

    // 2. Fetch
    let client_web = YouTubeClient::new(ClientType::Web);
    let client_android = YouTubeClient::new(ClientType::Android);

    let player_web = client_web.player(&video_id).await?;

    let details = &player_web["videoDetails"];
    
    // Check API key before fetching transcript for saving
    let api_key = db::get_setting(&db_path, "api_key").unwrap_or(None);
    let mut transcript = String::new();
    
    if api_key.is_some() && !api_key.unwrap().trim().is_empty() {
        let mut attempts = 0;
        loop {
            attempts += 1;
            let player_android_retry = client_android.player(&video_id).await?;
            match youtube::fetch_transcript(&player_android_retry).await {
                Ok(Some(t)) if !t.trim().is_empty() => {
                    transcript = t;
                    break;
                }
                Ok(_) | Err(_) if attempts < 3 => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
                _ => break,
            }
        }
    }

    if transcript.is_empty() {
        return Err("Cannot save video without transcript.".to_string());
    }

    let title = details["title"].as_str().unwrap_or("Unknown");
    let author = details["author"].as_str().unwrap_or("Unknown");
    let length = details["lengthSeconds"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
    let view_count = details["viewCount"].as_str().unwrap_or("0");
    let published_at = player_web["microformat"]["playerMicroformatRenderer"]["publishDate"].as_str().unwrap_or("");

    db::save_video(&db_path, &video_id, title, author, length, &transcript, view_count, published_at).map_err(|e| e.to_string())?;

    Ok(Video {
        thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
        id: video_id,
        title: title.to_string(),
        published_at: published_at.to_string(),
        view_count: view_count.to_string(),
        author: Some(author.to_string()),
        status: Some("saved".to_string()),
        date_added: None,
    })
}

#[command]
async fn fetch_saved_videos(app: tauri::AppHandle) -> Result<VideoResponse, String> {
    let db_path = get_db_path(&app);
    db::init_db(&db_path).map_err(|e| e.to_string())?;
    let videos = db::list_videos(&db_path).map_err(|e| e.to_string())?;
    Ok(VideoResponse {
        videos,
        continuation: None,
    })
}

#[command]
async fn delete_video(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    db::delete_video(&db_path, &video_id).map_err(|e| e.to_string())?;
    Ok("Deleted".to_string())
}

#[command]
async fn check_video_exists(app: tauri::AppHandle, video_id: String) -> Result<bool, String> {
    let db_path = get_db_path(&app);
    db::check_video_exists(&db_path, &video_id).map_err(|e| e.to_string())
}

#[command]
async fn bulk_save_videos(app: tauri::AppHandle, video_ids: Vec<String>) -> Result<Value, String> {
    let mut results = Vec::new();
    for id in video_ids {
        // We could run these in parallel but to avoid rate limits let's just do them sequentially or in small chunks
        // Given the request, let's just loop for now to be safe.
        match save_video(app.clone(), id).await {
            Ok(v) => results.push(serde_json::to_value(v).unwrap()),
            Err(e) => results.push(serde_json::json!({"error": e})),
        }
    }
    Ok(serde_json::Value::Array(results))
}

#[command]
async fn search_videos(_app: tauri::AppHandle, query: String) -> Result<VideoResponse, String> {
    let client = YouTubeClient::new(ClientType::Web);
    let data = client.search(&query).await?;
    let mut videos = Vec::new();

    if let Some(results) = data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]["sectionListRenderer"]["contents"].as_array() {
        for section in results {
            if let Some(item_section) = section["itemSectionRenderer"]["contents"].as_array() {
                for item in item_section {
                    if let Some(v_renderer) = item.get("videoRenderer") {
                        if let Some(v_json) = youtube::extract_video_basic_info(v_renderer) {
                            if let Ok(mut v) = serde_json::from_value::<Video>(v_json) {
                                v.date_added = None;
                                videos.push(v);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(VideoResponse {
        videos,
        continuation: None,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_openurl::init())
        .invoke_handler(tauri::generate_handler![
            resolve_channel,
            fetch_videos,
            fetch_channel_videos_v3,
            fetch_view_count,
            fetch_transcript,
            fetch_video_info,
            save_video,
            search_videos,
            fetch_saved_videos,
            delete_video,
            check_video_exists,
            bulk_save_videos,
            get_api_key,
            set_api_key,
            remove_api_key,
            open_db_location,
            get_db_details,
            get_display_settings,
            set_display_settings
        ])
        .setup(|app| {
            // Apply saved display settings on startup
            let app_handle = app.handle();
            let db_path = get_db_path(app_handle);
            
            let resolution = db::get_setting(&db_path, "resolution").unwrap_or(None).unwrap_or_else(|| "1440x900".to_string());
            let fullscreen = db::get_setting(&db_path, "fullscreen").unwrap_or(None).map(|s| s == "true").unwrap_or(false);
            
            if let Some(window) = app.get_webview_window("main") {
                let parts: Vec<&str> = resolution.split('x').collect();
                if parts.len() == 2 {
                    if let (Ok(w), Ok(h)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
                    }
                }
                let _ = window.set_fullscreen(fullscreen);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let db_path = get_db_path(app_handle);
                let _ = db::vacuum_db(&db_path);
            }
        });
}
