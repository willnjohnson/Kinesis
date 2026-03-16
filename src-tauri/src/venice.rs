use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use crate::{db, get_db_path};

#[derive(Debug, Serialize, Deserialize)]
pub struct VeniceMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VeniceRequest {
    pub model: String,
    pub messages: Vec<VeniceMessage>,
}

pub async fn summarize_transcript(app: AppHandle, transcript: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    
    let api_key = db::get_setting(&db_path, "venice_api_key")
        .map_err(|e| e.to_string())?
        .ok_or("Venice API key not found. Please set it in Settings.")?;
        
    let prompt_template = db::get_setting(&db_path, "venice_prompt")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "Create a synopsis of this video transcript with pretty format.".to_string());

    let prompt = if prompt_template.contains("{}") {
        prompt_template.replace("{}", &transcript)
    } else {
        format!("{}\n\nTranscript:\n{}", prompt_template, transcript)
    };

    let client = reqwest::Client::new();
    let request_body = VeniceRequest {
        model: "venice-uncensored".to_string(),
        messages: vec![VeniceMessage {
            role: "user".to_string(),
            content: prompt,
        }],
    };

    let response = client
        .post("https://api.venice.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Venice API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Venice API error: {} - {}", status, error_text));
    }

    let result: Value = response.json().await
        .map_err(|e| format!("Failed to parse Venice response: {}", e))?;

    let summary = result["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Failed to extract summary from Venice response")?
        .to_string();

    Ok(summary)
}


