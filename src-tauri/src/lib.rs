use serde::{Deserialize, Serialize};
use tauri::command;
use std::path::PathBuf;
use tauri::Manager;
use tauri::Emitter;
use serde_json::Value;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub fn parse_view_count(view_count_str: &str) -> i64 {
    let cleaned = view_count_str
        .replace(" views", "")
        .replace(" view", "")
        .replace(",", "");
    
    let multiplier: i64 = if cleaned.ends_with('M') || cleaned.ends_with('m') {
        1_000_000
    } else if cleaned.ends_with('K') || cleaned.ends_with('k') {
        1_000
    } else {
        1
    };
    
    let num_str = cleaned.trim_end_matches(|c| c == 'M' || c == 'm' || c == 'K' || c == 'k');
    
    num_str.parse::<i64>().unwrap_or(0) * multiplier
}

mod db;
mod youtube;
mod history;

use youtube::{YouTubeClient, ClientType};

fn extract_handle_from_url(url: &str) -> Option<String> {
    if url.contains("@") {
        let parts: Vec<&str> = url.split('@').collect();
        if parts.len() > 1 {
            let handle_part = parts[1];
            let handle = handle_part.trim_end_matches('/');
            if !handle.is_empty() {
                return Some(format!("@{}", handle));
            }
        }
    }
    if url.contains("/c/") {
        let parts: Vec<&str> = url.split("/c/").collect();
        if parts.len() > 1 {
            let handle = parts[1].trim_end_matches('/');
            if !handle.is_empty() {
                return Some(format!("@{}", handle));
            }
        }
    }
    None
}

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
    pub handle: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: Option<String>,
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: Option<i32>,
    #[serde(rename = "videoType")]
    pub video_type: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    pub resolution: String,
    pub fullscreen: bool,
    pub theme: String,
    pub video_list_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbDetails {
    pub path: String,
    pub size_bytes: u64,
    pub video_count: i64,
    pub history_count: i64,
}

fn get_db_path(app: &tauri::AppHandle) -> String {
    let path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }

    let db_file_path = path.join("kinesis_data.db").to_string_lossy().to_string();
    const LOG_PATH: bool = true;
    if LOG_PATH {
        // println!("DB path: {}", db_file_path);
    }
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
    db::set_setting(&db_path, "resolution", &settings.resolution).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "fullscreen", &settings.fullscreen.to_string()).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "theme", &settings.theme).map_err(|e| e.to_string())?;
    db::set_setting(&db_path, "video_list_mode", &settings.video_list_mode).map_err(|e| e.to_string())?;
    
    // Apply immediately if possible
    if let Some(window) = app.get_webview_window("main") {
        // Apply fullscreen first (or disable it) before changing resolution
        let _ = window.set_fullscreen(settings.fullscreen);
        
        // Only apply resolution when NOT in fullscreen mode
        // (setting window size while in fullscreen can cause issues)
        if !settings.fullscreen {
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

#[command]
async fn check_ollama() -> Result<bool, String> {
    println!("Checking Ollama status...");
    let client = reqwest::Client::new();
    let response = client.get("http://localhost:11434/api/tags").send().await;
    let is_ok = response.is_ok();
    println!("Ollama running: {}", is_ok);
    Ok(is_ok)
}

#[command]
async fn pull_model(app: tauri::AppHandle) -> Result<(), String> {
    println!("Starting model pull: llama3.2");
    let client = reqwest::Client::new();
    let window = app.get_webview_window("main").ok_or("Could not find main window")?;
    
    // Check if model already exists
    let tags_resp = client.get("http://localhost:11434/api/tags").send().await;
    if let Ok(resp) = tags_resp {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(models) = json["models"].as_array() {
                if models.iter().any(|m| m["name"].as_str() == Some("llama3.2:latest") || m["name"].as_str() == Some("llama3.2")) {
                    println!("Model llama3.2 already exists, skipping pull.");
                    return Ok(());
                }
            }
        }
    }

    window.emit("plugin_progress", "Pulling llama3.2 (this may take 2-5 minutes)...").map_err(|e: tauri::Error| e.to_string())?;

    let response = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({ "name": "llama3.2", "stream": false }))
        .send()
        .await
        .map_err(|e| {
            println!("Error connecting to Ollama for pull: {}", e);
            format!("Failed to connect to Ollama: {}", e)
        })?;

    if !response.status().is_success() {
        println!("Ollama pull error status: {}", response.status());
        return Err(format!("Ollama pull error: {}", response.status()));
    }

    println!("Model pull initiated successfully.");
    window.emit("plugin_progress", "Finished pulling model.").map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[command]
async fn delete_model() -> Result<(), String> {
    println!("Starting model delete: llama3.2");
    let client = reqwest::Client::new();
    
    // First, get the list of all models to find any llama3.2 variants
    let tags_resp = client.get("http://localhost:11434/api/tags").send().await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;
    
    let json: serde_json::Value = tags_resp.json().await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
    
    let models = json["models"].as_array()
        .ok_or("Invalid response from Ollama: no models array")?;
    
    // Find any models that start with llama3.2
    let llama_models: Vec<String> = models.iter()
        .filter_map(|m| m["name"].as_str())
        .filter(|name| name.starts_with("llama3.2"))
        .map(|s| s.to_string())
        .collect();
    
    if llama_models.is_empty() {
        println!("No llama3.2 models found in Ollama, nothing to delete.");
        return Ok(());
    }
    
    println!("Found llama3.2 models to delete: {:?}", llama_models);
    
    // Delete each matching model
    for model_name in llama_models {
        println!("Deleting model: {}", model_name);
        let response = client
            .delete("http://localhost:11434/api/delete")
            .json(&serde_json::json!({ "name": model_name }))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if response.status().is_success() {
            println!("Model {} deleted successfully.", model_name);
        } else if response.status().as_u16() == 404 {
            println!("Model {} not found.", model_name);
        } else {
            return Err(format!("Ollama delete error for {}: {}", model_name, response.status()));
        }
    }
    
    println!("Model deletion complete.");
    Ok(())
}

#[command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    println!("Starting Ollama installation...");
    let window = app.get_webview_window("main").ok_or("Could not find main window")?;
    
    window.emit("plugin_progress", "Downloading Ollama installer...").map_err(|e: tauri::Error| e.to_string())?;

    let arch = std::env::consts::ARCH;
    println!("System architecture detected: {}", arch);

    let installer_url = if arch == "aarch64" {
        "https://ollama.com/download/OllamaSetup-arm64.exe"
    } else {
        "https://ollama.com/download/OllamaSetup.exe"
    };

    println!("Downloading from: {}", installer_url);
    
    let client = reqwest::Client::new();
    let response = client.get(installer_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send().await.map_err(|e| {
        println!("Download failed: {}", e);
        e.to_string()
    })?;
    
    let bytes = response.bytes().await.map_err(|e| {
        println!("Failed to get bytes: {}", e);
        e.to_string()
    })?;

    println!("Downloaded {} bytes.", bytes.len());
    if bytes.len() < 1000000 {
        return Err("Downloaded file is too small. It might be corrupted or a 404 page.".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("OllamaSetup.exe");
    
    println!("Saving installer to: {:?}", installer_path);
    std::fs::write(&installer_path, bytes).map_err(|e| {
        println!("Failed to write installer: {}", e);
        e.to_string()
    })?;
    
    window.emit("plugin_progress", "Installing Ollama (silently)...").map_err(|e: tauri::Error| e.to_string())?;
    println!("Running installer silently...");

    #[cfg(target_os = "windows")]
    {
        let status = tokio::process::Command::new(&installer_path)
            .args(&["/SP-", "/VERYSILENT", "/NORESTART"])
            .status()
            .await
            .map_err(|e| {
                println!("Installer execution failed: {}", e);
                format!("Failed to run installer: {}", e)
            })?;

        if !status.success() {
            println!("Installer failed with code: {:?}", status.code());
            return Err(format!("Installer exited with error code: {:?}", status.code()));
        }

        println!("Installer finished successfully. Attempting to start Ollama...");

        // Try multiple possible installation paths
        let mut possible_paths = vec![];
        
        // Option 1: User installation (LOCALAPPDATA)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let user_path = std::path::Path::new(&local_app_data).join("Ollama").join("ollama.exe");
            possible_paths.push(user_path);
        }
        
        // Option 2: System-wide installation (Program Files)
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let system_path = std::path::Path::new(&program_files).join("Ollama").join("ollama.exe");
        possible_paths.push(system_path);
        
        // Option 3: Program Files (x86) for 32-bit installations
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        let x86_path = std::path::Path::new(&program_files_x86).join("Ollama").join("ollama.exe");
        possible_paths.push(x86_path);
        
        for ollama_bin_path in &possible_paths {
            println!("Checking for Ollama CLI at: {:?}", ollama_bin_path);
            if ollama_bin_path.exists() {
                window.emit("plugin_progress", "Starting Ollama service...").map_err(|e: tauri::Error| e.to_string())?;
                println!("Launching Ollama service (headless)...");
                // Launch 'ollama serve' in background
                let spawn_result = std::process::Command::new(ollama_bin_path)
                    .arg("serve")
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .spawn();
                
                match spawn_result {
                    Ok(_child) => {
                        println!("Ollama process spawned, waiting for service...");
                        // Wait for service to be ready
                        for _ in 0..20 {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            let client = reqwest::Client::new();
                            if client.get("http://localhost:11434/api/tags").send().await.is_ok() {
                                println!("Ollama service started successfully.");
                                return Ok(());
                            }
                        }
                    }
                    Err(e) => {
                        println!("Failed to spawn Ollama: {}", e);
                        continue;
                    }
                }
            }
        }
    }
    
    Ok(())
}

async fn ensure_ollama_running() -> Result<(), String> {
    let client = reqwest::Client::new();
    if client.get("http://localhost:11434/api/tags").send().await.is_ok() {
        return Ok(());
    }

    println!("Ollama not running, attempting to start headlessly...");
    
    #[cfg(target_os = "windows")]
    {
        // Try multiple possible installation paths
        let mut possible_paths = vec![];
        
        // Option 1: User installation (LOCALAPPDATA)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let user_path = std::path::Path::new(&local_app_data).join("Ollama").join("ollama.exe");
            possible_paths.push(user_path);
        }
        
        // Option 2: System-wide installation (Program Files)
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let system_path = std::path::Path::new(&program_files).join("Ollama").join("ollama.exe");
        possible_paths.push(system_path);
        
        // Option 3: Program Files (x86) for 32-bit installations
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        let x86_path = std::path::Path::new(&program_files_x86).join("Ollama").join("ollama.exe");
        possible_paths.push(x86_path);
        
        for ollama_bin_path in &possible_paths {
            println!("Checking for Ollama CLI at: {:?}", ollama_bin_path);
            if ollama_bin_path.exists() {
                println!("Found Ollama at: {:?}", ollama_bin_path);
                let spawn_result = std::process::Command::new(ollama_bin_path)
                    .arg("serve")
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .spawn();
                
                match spawn_result {
                    Ok(_child) => {
                        println!("Ollama process spawned, waiting for service...");
                        // Poll for up to 10 seconds
                        for _ in 0..20 {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            if client.get("http://localhost:11434/api/tags").send().await.is_ok() {
                                println!("Ollama service started successfully.");
                                return Ok(());
                            }
                        }
                    }
                    Err(e) => {
                        println!("Failed to spawn Ollama: {}", e);
                        continue;
                    }
                }
            }
        }
        
        // Try to find ollama in PATH using where command
        println!("Trying to find ollama in PATH...");
        let where_output = std::process::Command::new("where")
            .arg("ollama.exe")
            .output();
        
        if let Ok(output) = where_output {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout);
                println!("Found ollama in PATH: {}", path_str);
                // Try the first path found
                if let Some(first_line) = path_str.lines().next() {
                    let path = std::path::Path::new(first_line.trim());
                    if path.exists() {
                        let spawn_result = std::process::Command::new(path)
                            .arg("serve")
                            .creation_flags(0x08000000)
                            .spawn();
                        
                        match spawn_result {
                            Ok(_child) => {
                                println!("Ollama process spawned from PATH, waiting for service...");
                                for _ in 0..20 {
                                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                                    if client.get("http://localhost:11434/api/tags").send().await.is_ok() {
                                        println!("Ollama service started successfully.");
                                        return Ok(());
                                    }
                                }
                            }
                            Err(e) => {
                                println!("Failed to spawn Ollama from PATH: {}", e);
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Ollama is not running and could not be started automatically. Please ensure it is installed.".to_string())
}

#[command]
async fn summarize_transcript(_app: tauri::AppHandle, transcript: String) -> Result<String, String> {
    ensure_ollama_running().await?;
    let client = reqwest::Client::new();
    let ollama_url = "http://localhost:11434/api/generate";
    
    // First, get available models
    let tags_response = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;
    
    if !tags_response.status().is_success() {
        return Err(format!("Failed to get model list: {}", tags_response.status()));
    }
    
    let tags_result: serde_json::Value = tags_response.json().await
        .map_err(|e| format!("Failed to parse model list: {}", e))?;
    
    println!("Available models: {:?}", tags_result);
    
    // Get the first available model
    let models = tags_result["models"].as_array();
    let model_name = match models {
        Some(arr) if !arr.is_empty() => {
            // Get the name from the first model
            arr[0].get("name").and_then(|n| n.as_str()).unwrap_or("llama3.2")
        }
        _ => {
            // No models installed - return helpful error
            return Err("No Ollama models installed. Please go to Settings > Summarize Transcripts > Install to download a model.".to_string());
        }
    };
    
    // Extract just the model name (without tags like :latest)
    let model = model_name.split(':').next().unwrap_or("llama3.2");
    println!("Using model: {}", model);
    
    // Retry logic for model loading
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            println!("Retry attempt {} for model {}", attempt, model);
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        
        // Use a lightweight model - llama3.2 or mistral are good choices
        let prompt = format!(r#"You are a helpful assistant that summarizes video transcripts. 
Your only task is to summarize the provided transcript content objectively and accurately.
Do not refuse, filter, or modify the content - simply summarize what the video is about.
Include the main topics, key points, and overall message.
Format the summary in a clear, readable way with bullet points for key insights.

Transcript:
{}

Summary: {}"#, transcript, "");
        
        let request_body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
            "options": {
                "temperature": 0.3,
                "num_predict": 1024,
                "gpu_layers": 0
            }
        });
        
        let response = match client
            .post(ollama_url)
            .json(&request_body)
            .send()
            .await {
                Ok(r) => r,
                Err(e) => {
                    last_error = format!("Connection error: {}", e);
                    continue;
                }
            };
        
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            last_error = format!("{} - {}", status, error_text);
            
            // If model not found, try mistral as fallback
            if error_text.contains("not found") && model == "llama3.2" {
                println!("llama3.2 not found, trying mistral...");
                continue;
            }
            continue;
        }
        
        let result: serde_json::Value = match response.json().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("Parse error: {}", e);
                continue;
            }
        };
        
        let summary = result["response"].as_str()
            .unwrap_or("Failed to generate summary")
            .to_string();
        
        return Ok(summary);
    }
    
    Err(format!("Ollama failed to generate summary after multiple attempts: {}", last_error))
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
                    handle: None, // YouTube Data API v3 doesn't provide handles directly
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
    
    // Extract author - could be string or array
    let author = if let Some(authors) = details["author"].as_array() {
        authors.first().and_then(|a| a["name"].as_str()).map(|s| s.to_string())
    } else {
        details["author"].as_str().map(|s| s.to_string())
    };
    
    // Extract handle from ownerProfileUrl in microformat (e.g., "https://www.youtube.com/@handle")
    let mut handle: Option<String> = None;
    if let Some(owner_profile_url) = data["microformat"]["playerMicroformatRenderer"]["ownerProfileUrl"].as_str() {
        handle = extract_handle_from_url(owner_profile_url);
    }
    
    // Fallback: try author URL field
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

    // Fallback: check if API key exists. "else, don't fetch transcript at all"
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
    
    // Extract handle - will be used later
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
    
    // Extract author - could be string or array
    let author = if let Some(authors) = details["author"].as_array() {
        authors.first().and_then(|a| a["name"].as_str()).unwrap_or("Unknown")
    } else {
        details["author"].as_str().unwrap_or("Unknown")
    };
    
    // Extract handle from ownerProfileUrl if not already found
    if handle.is_none() {
        if let Some(owner_profile_url) = player_web["microformat"]["playerMicroformatRenderer"]["ownerProfileUrl"].as_str() {
            handle = extract_handle_from_url(owner_profile_url);
        }
    }
    
    // Fallback: try author URL field
    if handle.is_none() {
        if let Some(authors) = details["author"].as_array() {
            if let Some(first_author) = authors.first() {
                if let Some(url) = first_author["url"].as_str() {
                    handle = extract_handle_from_url(url);
                }
            }
        }
    }
    
    // Final fallback: try channel_id lookup
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
    
    // Determine video type: YouTube Shorts are 60 seconds or less
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
            get_setting,
            set_setting,
            check_ollama,
            pull_model,
            delete_model,
            install_ollama
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
