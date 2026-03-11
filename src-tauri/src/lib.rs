use serde_json::Value;
use std::path::PathBuf;
use tauri::{command, Manager};


mod db;
mod youtube;
mod history;
mod types;
mod ollama;

pub use types::{Video, ChannelInfo, VideoResponse, DisplaySettings, DbDetails};
pub use types::{parse_view_count, extract_handle_from_url};

use youtube::{YouTubeClient, ClientType};

fn get_db_path(app: &tauri::AppHandle) -> String {
    let path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }

    let db_file_path = path.join("kinesis_data.db").to_string_lossy().to_string();
    let _ = db::init_db(&db_file_path);
    db_file_path
}

// ============== Settings Commands ==============

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
    let history_count = db::get_history_stats(&path).map_err(|e| e.to_string())?;
    
    Ok(DbDetails {
        path,
        size_bytes,
        video_count,
        history_count,
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
    let theme = db::get_setting(&db_path, "theme")
        .unwrap_or(None)
        .unwrap_or_else(|| "dark".to_string());
    let video_list_mode = db::get_setting(&db_path, "video_list_mode")
        .unwrap_or(None)
        .unwrap_or_else(|| "grid".to_string());
        
    Ok(DisplaySettings {
        resolution,
        fullscreen,
        theme,
        video_list_mode,
    })
}

#[command]
fn set_display_settings(app: tauri::AppHandle, settings: DisplaySettings) -> Result<(), String> {
    let db_path = get_db_path(&app);
    
    // Get current resolution to check if it actually changed
    let current_resolution = db::get_setting(&db_path, "resolution").map_err(|e| e.to_string())?.unwrap_or_else(|| "1440x900".to_string());
    let resolution_changed = current_resolution != settings.resolution;
    
    db::set_setting(&db_path, "resolution", &settings.resolution).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "fullscreen", &settings.fullscreen.to_string()).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "theme", &settings.theme).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "video_list_mode", &settings.video_list_mode).map_err(|e| e.to_string())?;
    
    // Apply immediately if possible - only resize if resolution actually changed
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_fullscreen(settings.fullscreen);
        
        if !settings.fullscreen && resolution_changed {
            let parts: Vec<&str> = settings.resolution.split('x').collect();
            if parts.len() == 2 {
                if let (Ok(w), Ok(h)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
                }
            }
        }
    }
    
    Ok(())
}

#[command]
async fn get_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let db_path = get_db_path(&app);
    db::get_setting(&db_path, &key).map_err(|e| e.to_string())
}

#[command]
async fn set_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::set_setting(&db_path, &key, &value).map_err(|e| e.to_string())
}

// ============== Ollama Commands ==============

#[command]
async fn check_ollama() -> Result<bool, String> {
    ollama::check_ollama().await
}

#[command]
async fn pull_model(app: tauri::AppHandle) -> Result<(), String> {
    ollama::pull_model(app).await
}

#[command]
async fn delete_model() -> Result<(), String> {
    ollama::delete_model().await
}

#[command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    ollama::install_ollama(app).await
}

#[command]
async fn summarize_transcript(app: tauri::AppHandle, transcript: String) -> Result<String, String> {
    ollama::summarize_transcript(app, transcript).await
}

#[command]
async fn save_summary(app: tauri::AppHandle, video_id: String, summary: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::save_summary(&db_path, &video_id, &summary).map_err(|e| e.to_string())
}

#[command]
async fn get_summary(app: tauri::AppHandle, video_id: String) -> Result<Option<String>, String> {
    let db_path = get_db_path(&app);
    db::get_summary(&db_path, &video_id).map_err(|e| e.to_string())
}

#[command]
async fn get_summarized_count(app: tauri::AppHandle) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    db::get_summarized_count(&db_path).map_err(|e| e.to_string())
}

#[command]
async fn get_videos_with_summaries(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db_path = get_db_path(&app);
    db::get_videos_with_summaries(&db_path).map_err(|e| e.to_string())
}

#[command]
async fn summarize_all_videos(app: tauri::AppHandle) -> Result<i32, String> {
    let db_path = get_db_path(&app);
    
    // Get all videos without summaries
    let videos_without_summary: Vec<(String, String)> = {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT video_id, transcript FROM videos WHERE (summary IS NULL OR summary = '') AND transcript IS NOT NULL AND transcript != ''"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let video_id: String = row.get(0).map_err(|e| e.to_string())?;
            let transcript: String = row.get(1).map_err(|e| e.to_string())?;
            result.push((video_id, transcript));
        }
        result
    };
    
    if videos_without_summary.is_empty() {
        return Ok(0);
    }
    
    // Ensure Ollama is running once at the start
    ollama::ensure_ollama_running().await?;
    
    let mut summarized_count = 0;
    
    // Process videos with a delay between each to avoid overwhelming the system
    for (video_id, transcript) in videos_without_summary {
        match ollama::summarize_transcript(app.clone(), transcript).await {
            Ok(summary) => {
                if let Err(e) = db::save_summary(&db_path, &video_id, &summary) {
                    eprintln!("Failed to save summary for {}: {}", video_id, e);
                } else {
                    summarized_count += 1;
                }
            }
            Err(e) => {
                eprintln!("Failed to summarize {}: {}", video_id, e);
            }
        }
        
        // Small delay between videos
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
    
    Ok(summarized_count)
}

// ============== YouTube Commands ==============

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

    let uploads_playlist_id = if channel_id.starts_with("UC") {
        format!("UU{}", &channel_id[2..])
    } else {
        channel_id.clone()
    };

    let mut url = format!("https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId={}&key={}", uploads_playlist_id, api_key);
    if let Some(token) = continuation.as_ref() {
        url = format!("{}&pageToken={}", url, token);
    }

    let mut res: Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

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
                    handle: None,
                    status: None,
                    date_added: None,
                    length_seconds: None,
                    video_type: None,
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
    
    let author = if let Some(authors) = details["author"].as_array() {
        authors.first().and_then(|a| a["name"].as_str()).map(|s| s.to_string())
    } else {
        details["author"].as_str().map(|s| s.to_string())
    };
    
    let mut handle: Option<String> = None;
    if let Some(owner_profile_url) = data["microformat"]["playerMicroformatRenderer"]["ownerProfileUrl"].as_str() {
        handle = extract_handle_from_url(owner_profile_url);
    }
    
    if handle.is_none() {
        if let Some(authors) = details["author"].as_array() {
            if let Some(first_author) = authors.first() {
                if let Some(url) = first_author["url"].as_str() {
                    handle = extract_handle_from_url(url);
                }
            }
        }
    }
    
    Ok(Video {
        id: details["videoId"].as_str().unwrap_or(&video_id).to_string(),
        title: details["title"].as_str().unwrap_or("Unknown").to_string(),
        thumbnail: details["thumbnail"]["thumbnails"].as_array().and_then(|a| a.last()).and_then(|t| t["url"].as_str()).unwrap_or("").to_string(),
        published_at,
        view_count: parse_view_count(details["viewCount"].as_str().unwrap_or("0")).to_string(),
        author,
        handle,
        status: None,
        date_added: None,
        length_seconds: None,
        video_type: None,
    })
}

#[command]
async fn fetch_transcript(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let video_id = video_id.trim().to_string();
    let db_path = get_db_path(&app);
    
    // Attempt to fetch from database first
    match db::get_transcript(&db_path, &video_id) {
        Ok(Some(transcript)) => {
            if !transcript.trim().is_empty() {
                return Ok(transcript);
            }
        },
        _ => {}
    }

    let api_key = db::get_setting(&db_path, "api_key").unwrap_or(None);
    if api_key.is_none() || api_key.unwrap().trim().is_empty() {
        return Err("API_KEY_MISSING".to_string());
    }

    let client = YouTubeClient::new(ClientType::Android);

    let mut attempts = 0;
    loop {
        attempts += 1;
        match client.player(&video_id).await {
            Ok(player_json) => {
                match youtube::fetch_transcript(&player_json).await {
                    Ok(Some(t)) if !t.trim().is_empty() => return Ok(t),
                    Ok(_) | Err(_) if attempts < 3 => {
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    Ok(_) => return Err("No transcript available for this video.".to_string()),
                    Err(e) => return Err(format!("Transcript error: {}", e)),
                }
            },
            Err(e) => {
                if attempts < 3 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
                return Err(format!("Player API error: {}", e));
            }
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
            view_count: v_data.5.to_string(),
            author: Some(v_data.2),
            handle: Some(v_data.7),
            status: Some("exists".to_string()),
            date_added: None,
            length_seconds: Some(v_data.3),
            video_type: Some(v_data.8),
        });
    }

    // 2. Fetch
    let client_web = YouTubeClient::new(ClientType::Web);
    let client_android = YouTubeClient::new(ClientType::Android);

    let player_web = client_web.player(&video_id).await?;

    let details = &player_web["videoDetails"];
    
    let mut handle: Option<String> = None;
    if let Some(authors) = details["author"].as_array() {
        if let Some(first_author) = authors.first() {
            if let Some(channel_id) = first_author["channel_id"].as_str() {
                handle = youtube::extract_handle_from_channel_id(channel_id).await.ok().flatten();
            }
        }
    }
    
    let mut transcript = String::new();
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

    if transcript.is_empty() {
        return Err("Cannot save video without transcript.".to_string());
    }

    let title = details["title"].as_str().unwrap_or("Unknown");
    
    let author = if let Some(authors) = details["author"].as_array() {
        authors.first().and_then(|a| a["name"].as_str()).unwrap_or("Unknown")
    } else {
        details["author"].as_str().unwrap_or("Unknown")
    };
    
    if handle.is_none() {
        if let Some(owner_profile_url) = player_web["microformat"]["playerMicroformatRenderer"]["ownerProfileUrl"].as_str() {
            handle = extract_handle_from_url(owner_profile_url);
        }
    }
    
    if handle.is_none() {
        if let Some(authors) = details["author"].as_array() {
            if let Some(first_author) = authors.first() {
                if let Some(url) = first_author["url"].as_str() {
                    handle = extract_handle_from_url(url);
                }
            }
        }
    }
    
    if handle.is_none() {
        if let Some(authors) = details["author"].as_array() {
            if let Some(first_author) = authors.first() {
                if let Some(channel_id) = first_author["channel_id"].as_str() {
                    handle = youtube::extract_handle_from_channel_id(channel_id).await.ok().flatten();
                }
            }
        }
    }
    
    let length = details["lengthSeconds"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
    let view_count_str = details["viewCount"].as_str().unwrap_or("0");
    let view_count = parse_view_count(view_count_str);
    let published_at = player_web["microformat"]["playerMicroformatRenderer"]["publishDate"].as_str().unwrap_or("");
    
    let video_type = if length > 0 && length <= 60 { "short" } else { "standard" };

    db::save_video(&db_path, &video_id, title, author, length, &transcript, view_count, published_at, handle.as_deref().unwrap_or(""), video_type).map_err(|e| e.to_string())?;

    Ok(Video {
        thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
        id: video_id,
        title: title.to_string(),
        published_at: published_at.to_string(),
        view_count: view_count.to_string(),
        author: Some(author.to_string()),
        handle,
        status: Some("saved".to_string()),
        date_added: None,
        length_seconds: Some(length),
        video_type: Some(video_type.to_string()),
    })
}

#[command]
async fn fetch_saved_videos(app: tauri::AppHandle, video_type: Option<String>) -> Result<VideoResponse, String> {
    let db_path = get_db_path(&app);
    db::init_db(&db_path).map_err(|e| e.to_string())?;
    let videos = db::list_videos(&db_path, video_type.as_deref()).map_err(|e| e.to_string())?;
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

// ============== History Commands ==============

#[command]
fn add_search_history(app: tauri::AppHandle, query: String) -> Result<(), String> {
    let path = get_db_path(&app);
    history::add_history(&path, &query).map_err(|e| e.to_string())
}

#[command]
fn get_search_history(app: tauri::AppHandle, limit: Option<i64>) -> Result<Vec<history::HistoryEntry>, String> {
    let path = get_db_path(&app);
    history::get_history(&path, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[command]
fn clear_history_before_date(app: tauri::AppHandle, date: String) -> Result<usize, String> {
    let path = get_db_path(&app);
    history::clear_history_before(&path, &date).map_err(|e| e.to_string())
}

#[command]
fn delete_history_entry(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = get_db_path(&app);
    history::delete_history_entry(&path, id).map_err(|e| e.to_string())
}

#[command]
fn clear_all_history(app: tauri::AppHandle) -> Result<(), String> {
    let path = get_db_path(&app);
    history::clear_all_history(&path).map_err(|e| e.to_string())
}

// ============== App Entry Point ==============

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_openurl::init())
        .plugin(tauri_plugin_dialog::init())
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
            set_display_settings,
            add_search_history,
            get_search_history,
            clear_history_before_date,
            delete_history_entry,
            clear_all_history,
            summarize_transcript,
            save_summary,
            get_summary,
            get_summarized_count,
            get_videos_with_summaries,
            summarize_all_videos,
            get_setting,
            set_setting,
            check_ollama,
            pull_model,
            delete_model,
            install_ollama
        ])
        .setup(|app| {
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
