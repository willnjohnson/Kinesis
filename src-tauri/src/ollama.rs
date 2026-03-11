use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Check if Ollama is running
pub async fn check_ollama() -> Result<bool, String> {
    println!("Checking Ollama status...");
    let client = reqwest::Client::new();
    let response = client.get("http://localhost:11434/api/tags").send().await;
    let is_ok = response.is_ok();
    println!("Ollama running: {}", is_ok);
    Ok(is_ok)
}

/// Pull a model from Ollama (llama3.2)
pub async fn pull_model(app: AppHandle) -> Result<(), String> {
    println!("Starting model pull: llama3.2");
    let client = reqwest::Client::new();
    let window = app.get_webview_window("main").ok_or("Could not find main window")?;
    
    // Check if model already exists
    let tags_resp = client.get("http://localhost:11434/api/tags").send().await;
    if let Ok(resp) = tags_resp {
        if let Ok(json) = resp.json::<Value>().await {
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

/// Delete llama3.2 model from Ollama
pub async fn delete_model() -> Result<(), String> {
    println!("Starting model delete: llama3.2");
    let client = reqwest::Client::new();
    
    // First, get the list of all models to find any llama3.2 variants
    let tags_resp = client.get("http://localhost:11434/api/tags").send().await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;
    
    let json: Value = tags_resp.json().await
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

/// Try to ensure Ollama is running, start it if not
pub async fn ensure_ollama_running() -> Result<(), String> {
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

/// Install Ollama on the current system
pub async fn install_ollama(app: AppHandle) -> Result<(), String> {
    println!("Starting Ollama installation...");
    let window = app.get_webview_window("main").ok_or("Could not find main window")?;
    
    window.emit("plugin_progress", "Downloading Ollama installer...").map_err(|e: tauri::Error| e.to_string())?;

    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    println!("Detected OS: {}, architecture: {}", os, arch);

    // Handle Linux installation using the official install script
    #[cfg(target_os = "linux")]
    {
        println!("Detected Linux. Running official Ollama install script...");
        window.emit("plugin_progress", "Running Ollama install script (may require sudo)...").map_err(|e: tauri::Error| e.to_string())?;

        // Run the official install script: curl -fsSL https://ollama.com/install.sh | sh
        let output = tokio::process::Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .output()
            .await
            .map_err(|e| {
                let msg = format!("Failed to run install script: {}", e);
                println!("{}", msg);
                msg
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!("Install script stdout: {}", stdout);
        println!("Install script stderr: {}", stderr);

        if !output.status.success() {
            let msg = format!("Install script failed with code: {:?}. stderr: {}", output.status.code(), stderr);
            println!("{}", msg);
            window.emit("plugin_progress", msg.clone()).map_err(|e: tauri::Error| e.to_string())?;
            return Err(msg);
        }

        println!("Install script completed successfully. Starting Ollama service...");
        window.emit("plugin_progress", "Starting Ollama service...").map_err(|e: tauri::Error| e.to_string())?;

        // Start the systemd service (the install script sets this up)
        let start_output = tokio::process::Command::new("sudo")
            .args(&["systemctl", "start", "ollama"])
            .output()
            .await
            .map_err(|e| {
                let msg = format!("Failed to start ollama service: {}", e);
                println!("{}", msg);
                msg
            })?;

        if !start_output.status.success() {
            let stderr = String::from_utf8_lossy(&start_output.stderr);
            let msg = format!("Failed to start ollama service: {}", stderr);
            println!("{}", msg);
            window.emit("plugin_progress", msg.clone()).map_err(|e: tauri::Error| e.to_string())?;
            return Err(msg);
        }

        // Poll the health endpoint until Ollama is ready (up to 30 seconds)
        println!("Waiting for Ollama API to be ready...");
        window.emit("plugin_progress", "Waiting for Ollama API to be ready...").map_err(|e: tauri::Error| e.to_string())?;
        
        let client = reqwest::Client::new();
        let mut ready = false;
        for attempt in 0..30 {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            match client.get("http://127.0.0.1:11434/api/ping").send().await {
                Ok(resp) if resp.status().is_success() => {
                    println!("Ollama API is ready!");
                    ready = true;
                    break;
                }
                _ => {
                    if attempt % 5 == 0 {
                        println!("Waiting for Ollama (attempt {})", attempt);
                    }
                }
            }
        }

        if !ready {
            let msg = "Ollama service started but API is not responding after 30 seconds. Please check the service status: sudo systemctl status ollama".to_string();
            println!("{}", msg);
            window.emit("plugin_progress", msg.clone()).map_err(|e: tauri::Error| e.to_string())?;
            return Err(msg);
        }

        println!("Ollama installation and startup completed successfully!");
        window.emit("plugin_progress", "Ollama installed and ready!".to_string()).map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    // Handle macOS and other platforms
    #[cfg(target_os = "macos")]
    {
        println!("Detected macOS. macOS installation not yet implemented; please visit https://ollama.com/download");
        let msg = "macOS automatic installation not yet implemented. Please install Ollama from https://ollama.com/download".to_string();
        window.emit("plugin_progress", msg.clone()).map_err(|e: tauri::Error| e.to_string())?;
        return Err(msg);
    }

    // Windows installation
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

/// Summarize a transcript using Ollama
pub async fn summarize_transcript(_app: AppHandle, transcript: String) -> Result<String, String> {
    ensure_ollama_running().await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))  // 2 minute timeout for CPU-based generation
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
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
    
    let tags_result: Value = tags_response.json().await
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
        
        // Keep prompt concise for faster generation on CPU
        let prompt = format!(r#"Summarize this video transcript in 2-3 paragraphs. Be concise and include main topics and key points only.

Transcript:
{}

Summary:"#, transcript);
        
        let request_body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
            "keep_alive": 300,  // Keep model loaded for 5 minutes (300 seconds)
            "options": {
                "temperature": 0.3,
                "num_predict": 512,
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
                    println!("Request failed: {}", last_error);
                    continue;
                }
            };
        
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            last_error = format!("{} - {}", status, error_text);
            println!("HTTP error: {}", last_error);
            continue;
        }
        
        let result: Value = match response.json().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("Parse error: {}", e);
                println!("Parse error: {}", last_error);
                continue;
            }
        };
        
        let summary = result["response"].as_str()
            .unwrap_or("Failed to generate summary")
            .trim()
            .to_string();
        
        println!("Summary generated successfully: {} chars", summary.len());
        return Ok(summary);
    }
    
    Err(format!("Ollama failed to generate summary after multiple attempts: {}", last_error))
}
