use serde::{Deserialize, Serialize};
use tauri::command;
use tauri_plugin_shell::ShellExt;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Video {
    id: String,
    title: String,
    thumbnail: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    #[serde(rename = "viewCount")]
    view_count: String,
    author: Option<String>,
    // Optional status field for returning save state
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

// Helper to run python script
async fn run_python_script(app: &tauri::AppHandle, script: &str, args: &[&str]) -> Result<String, String> {
    // 1. Try to find in resources (Production)
    let resource_path = app.path().resource_dir()
        .map(|p| p.join("bin").join(script))
        .ok();

    // 2. Fallback paths (Development)
    let possible_paths = vec![
        resource_path,
        Some(PathBuf::from("src-tauri/bin").join(script)),
        Some(PathBuf::from("bin").join(script)),
        Some(PathBuf::from("../src-tauri/bin").join(script)),
    ];
    
    let mut final_path = None;
    for p_opt in possible_paths {
        if let Some(p) = p_opt {
            if p.exists() {
                final_path = Some(p);
                break;
            }
        }
    }

    let path = match final_path {
        Some(p) => p,
        None => {
            let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_else(|_| "unknown".to_string());
            return Err(format!("Script '{}' not found in resources or local paths. CWD: {}.", script, cwd));
        }
    };


    let output = app.shell()
        .command("python")
        .args(&[&path.to_string_lossy().to_string()])
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute python: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() { "Unknown python error".to_string() } else { stderr })
    }
}

/// Resolve a YouTube handle or username to channel ID
#[command]
async fn resolve_channel(app: tauri::AppHandle, query: String) -> Result<ChannelInfo, String> {
    let output = run_python_script(&app, "kinesis_cli.py", &["--resolve", &query]).await?;
    let info: ChannelInfo = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse resolve output: {}", e))?;
    Ok(info)
}

/// Fetch videos from a channel or playlist
#[command]
async fn fetch_videos(
    app: tauri::AppHandle,
    id: String,
    is_playlist: bool,
    _continuation: Option<String>,
) -> Result<VideoResponse, String> {
    let flag = if is_playlist { "-l" } else { "-c" };
    let output = run_python_script(&app, "kinesis_cli.py", &[flag, &id, "--json"]).await?;
    
    // kinesis_cli with --json outputs one JSON object per line
    let mut videos = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
             let video = Video {
                 id: v["id"].as_str().unwrap_or_default().to_string(),
                 title: v["title"].as_str().unwrap_or_default().to_string(),
                 thumbnail: v["thumbnail"].as_str().unwrap_or_default().to_string(),
                 published_at: v["publishedAt"].as_str().unwrap_or_default().to_string(),
                 view_count: v["viewCount"].as_str().unwrap_or("0").to_string(),
                 author: v["author"].as_str().map(|s| s.to_string()),
                 status: None,
             };
             videos.push(video);
        }
    }
    
    Ok(VideoResponse {
        videos,
        continuation: None, // We fetch all at once now
    })
}

#[command]
async fn fetch_view_count(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    // kinesis_cli -i get info
    let output = run_python_script(&app, "kinesis_cli.py", &["-i", &video_id, "--json"]).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse info: {}", e))?;
    Ok(json["viewCount"].as_str().unwrap_or("0").to_string())
}

#[command]
async fn fetch_video_info(app: tauri::AppHandle, video_id: String) -> Result<Video, String> {
    let output = run_python_script(&app, "kinesis_cli.py", &["-i", &video_id, "--json"]).await?;
    let v: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse info: {}", e))?;

    Ok(Video {
         id: v["id"].as_str().unwrap_or(&video_id).to_string(),
         title: v["title"].as_str().unwrap_or("Unknown").to_string(),
         thumbnail: v["thumbnail"].as_str().unwrap_or("").to_string(),
         published_at: v["publishedAt"].as_str().unwrap_or("").to_string(),
         view_count: v["viewCount"].as_str().unwrap_or("0").to_string(),
         author: v["author"].as_str().map(|s| s.to_string()),
         status: None,
    })
}

#[command]
async fn fetch_transcript(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    // Use manager.py to check/fetch WITHOUT saving (peek)
    // Output of manager.py peek <id> is JSON: { "transcript": "...", ... }
    let output = run_python_script(&app, "manager.py", &["--db", &db_path, "peek", &video_id]).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse manager output: {}", e))?;
    
    if let Some(err) = json.get("error") {
        return Err(err.as_str().unwrap_or("Unknown error").to_string());
    }

    Ok(json["transcript"].as_str().unwrap_or("").to_string())
}

// New command primarily for "Saving" without just returning transcript
#[command]
async fn save_video(app: tauri::AppHandle, video_id: String) -> Result<Video, String> {
    let db_path = get_db_path(&app);
    let output = run_python_script(&app, "manager.py", &["--db", &db_path, "get", &video_id]).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse manager output: {}", e))?;
    
    if let Some(err) = json.get("error") {
         return Err(err.as_str().unwrap_or("Unknown error").to_string());
    }
    
    // Return video info
     Ok(Video {
         id: json["video_id"].as_str().unwrap_or(&video_id).to_string(),
         title: json["title"].as_str().unwrap_or("").to_string(),
         thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id), // manager doesn't return thumbnail url yet, assume default
         published_at: "".to_string(),
         view_count: "0".to_string(),
         author: json["author"].as_str().map(|s| s.to_string()),
         status: json["status"].as_str().map(|s| s.to_string()),
    })
}

#[command]
async fn fetch_saved_videos(app: tauri::AppHandle) -> Result<VideoResponse, String> {
    let db_path = get_db_path(&app);
    let output = run_python_script(&app, "manager.py", &["--db", &db_path, "list"]).await?;
    
    // Output is a JSON array of video objects (simplified)
    let json_val: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse list output: {}", e))?;
    
    let mut videos = Vec::new();
    if let Some(arr) = json_val.as_array() {
        for v in arr {
             let id = v["id"].as_str().unwrap_or_default().to_string();
             let video = Video {
                 id: id.clone(),
                 title: v["title"].as_str().unwrap_or_default().to_string(),
                 thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id),
                 published_at: "".to_string(), // Not stored in simplified list
                 view_count: "Saved".to_string(),
                 author: v["author"].as_str().map(|s| s.to_string()),
                 status: Some("saved".to_string()),
             };
             videos.push(video);
        }
    }
    
    Ok(VideoResponse {
        videos,
        continuation: None,
    })
}

#[command]
async fn delete_video(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    let output = run_python_script(&app, "manager.py", &["--db", &db_path, "delete", &video_id]).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse delete output: {}", e))?;
        
    if let Some(err) = json.get("error") {
        return Err(err.as_str().unwrap_or("Unknown error").to_string());
    }
    
    Ok("Deleted".to_string())
}

#[command]
async fn check_video_exists(app: tauri::AppHandle, video_id: String) -> Result<bool, String> {
    let db_path = get_db_path(&app);
    let output = run_python_script(&app, "manager.py", &["--db", &db_path, "check", &video_id]).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse check output: {}", e))?;
    
    Ok(json["exists"].as_bool().unwrap_or(false))
}

#[command]
async fn bulk_save_videos(app: tauri::AppHandle, video_ids: Vec<String>) -> Result<serde_json::Value, String> {
    let db_path = get_db_path(&app);
    let args = vec!["--db", &db_path, "bulk-save"];
    
    let vid_refs: Vec<&str> = video_ids.iter().map(|s| s.as_str()).collect();
    let mut final_args = args;
    final_args.extend(vid_refs);

    let output = run_python_script(&app, "manager.py", &final_args).await?;
    let json: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse bulk-save output: {}", e))?;
    
    Ok(json)
}


// Search for videos
#[command]
async fn search_videos(
    app: tauri::AppHandle,
    query: String,
) -> Result<VideoResponse, String> {
    let output = run_python_script(&app, "kinesis_cli.py", &["-s", &query, "--json"]).await?;
    
    // kinesis_cli -s --json outputs a single JSON array: [{"id":...}, ...]
    let json_val: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse search output: {}", e))?;
    
    let mut videos = Vec::new();
    
    if let Some(arr) = json_val.as_array() {
        for v in arr {
             let video = Video {
                 id: v["id"].as_str().unwrap_or_default().to_string(),
                 title: v["title"].as_str().unwrap_or_default().to_string(),
                 thumbnail: v["thumbnail"].as_str().unwrap_or_default().to_string(),
                 published_at: v["publishedAt"].as_str().unwrap_or_default().to_string(),
                 view_count: v["viewCount"].as_str().unwrap_or("0").to_string(),
                 author: v["author"].as_str().map(|s| s.to_string()),
                 status: None,
             };
             videos.push(video);
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
