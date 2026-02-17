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
    id: String,
    title: String,
    thumbnail: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    #[serde(rename = "viewCount")]
    view_count: String,
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
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

fn get_db_path(app: &tauri::AppHandle) -> String {
    let path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }
    path.join("kinesis_data.db").to_string_lossy().to_string()
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
                            if let Ok(v) = serde_json::from_value::<Video>(v_json) {
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
                        if let Ok(v) = serde_json::from_value::<Video>(v_json) {
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
    
    Ok(Video {
        id: details["videoId"].as_str().unwrap_or(&video_id).to_string(),
        title: details["title"].as_str().unwrap_or("Unknown").to_string(),
        thumbnail: details["thumbnail"]["thumbnails"].as_array().and_then(|a| a.last()).and_then(|t| t["url"].as_str()).unwrap_or("").to_string(),
        published_at: "".to_string(),
        view_count: details["viewCount"].as_str().unwrap_or("0").to_string(),
        author: details["author"].as_str().map(|s| s.to_string()),
        status: None,
    })
}

#[command]
async fn fetch_transcript(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    if let Ok(Some(transcript)) = db::get_transcript(&db_path, &video_id) {
        return Ok(transcript);
    }

    let client = YouTubeClient::new(ClientType::Android);
    let player_json = client.player(&video_id).await?;
    let transcript = youtube::fetch_transcript(&player_json).await?.ok_or("No transcript available")?;
    Ok(transcript)
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
            published_at: "".to_string(),
            view_count: "Saved".to_string(),
            author: Some(v_data.2),
            status: Some("exists".to_string()),
        });
    }

    // 2. Fetch
    let client_web = YouTubeClient::new(ClientType::Web);
    let client_android = YouTubeClient::new(ClientType::Android);

    let player_web = client_web.player(&video_id).await?;
    let player_android = client_android.player(&video_id).await?;

    let details = &player_web["videoDetails"];
    let transcript = youtube::fetch_transcript(&player_android).await?.unwrap_or("No transcript available.".to_string());

    let title = details["title"].as_str().unwrap_or("Unknown");
    let author = details["author"].as_str().unwrap_or("Unknown");
    let length = details["lengthSeconds"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);

    db::save_video(&db_path, &video_id, title, author, length, &transcript).map_err(|e| e.to_string())?;

    Ok(Video {
        thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
        id: video_id,
        title: title.to_string(),
        published_at: "".to_string(),
        view_count: "Saved".to_string(),
        author: Some(author.to_string()),
        status: Some("saved".to_string()),
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
                            if let Ok(v) = serde_json::from_value::<Video>(v_json) {
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
            fetch_view_count,
            fetch_transcript,
            fetch_video_info,
            save_video,
            search_videos,
            fetch_saved_videos,
            delete_video,
            check_video_exists,
            bulk_save_videos
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let db_path = get_db_path(app_handle);
                let _ = db::vacuum_db(&db_path);
            }
        });
}
