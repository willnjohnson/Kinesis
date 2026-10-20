use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use crate::sync::license::{self, Route};
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

// Fallback used whenever the `venice_model` setting is unset — kept in sync with schema.rs's
// default seed value for that key.
const DEFAULT_VENICE_MODEL: &str = "zai-org-glm-5";

async fn call_venice_api(client: &reqwest::Client, route: &Route, model: &str, prompt: &str) -> Result<String, String> {
    let request_body = VeniceRequest {
        model: model.to_string(),
        messages: vec![VeniceMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
    };

    // Direct with the user's own key, or through the sync server's license proxy (license.rs).
    let response = route
        .apply(client.post(route.url("chat/completions")))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Venice API request failed: {}", e))?;

    let status = response.status();
    let error_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Venice API error: {} - {}", status, error_text));
    }

    let result: Value = serde_json::from_str(&error_text)
        .map_err(|e| format!("Failed to parse Venice response: {}", e))?;

    let summary = result["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Failed to extract summary from Venice response")?
        .to_string();

    Ok(summary)
}

/// Summarizes a transcript via the Venice cloud API (the "cloud" provider counterpart to
/// ollama::summarize_transcript). Prefers a per-handle custom cloud prompt over the global
/// venice_prompt setting, and substitutes `${title}`/`${author}`/`${length_seconds}`/
/// `${view_count}`/`${handle}` placeholders from the saved video (or bare `${handle}`) when
/// present in the template. Unlike the Ollama path, there is no chunking — the full transcript
/// is sent in one request.
pub async fn summarize_transcript(app: AppHandle, transcript: String, handle: Option<String>, video_id: Option<String>) -> Result<String, String> {
    let db_path = get_db_path(&app);
    
    let route = license::route(&db_path, "venice")
        .ok_or("Venice API key not found. Please set it in Settings.")?;

    let mut prompt_template = None;
    if let Some(ref h) = handle {
        if let Ok(Some((_, Some(cloud_prompt)))) = db::get_custom_prompt(&db_path, h) {
            if !cloud_prompt.trim().is_empty() {
                prompt_template = Some(cloud_prompt);
            }
        }
    }
    
    let mut prompt_template = prompt_template.unwrap_or_else(|| {
        db::get_setting(&db_path, "venice_prompt")
            .unwrap_or(None)
            .unwrap_or_else(|| "Create a synopsis of this video transcript with pretty format.".to_string())
    });

    if let Some(vid) = &video_id {
        if let Ok(Some(video)) = db::get_video_full(&db_path, vid) {
            prompt_template = prompt_template.replace("${title}", &video.1);
            prompt_template = prompt_template.replace("${author}", &video.2);
            prompt_template = prompt_template.replace("${length_seconds}", &video.3.to_string());
            prompt_template = prompt_template.replace("${view_count}", &video.5.to_string());
            prompt_template = prompt_template.replace("${handle}", &video.7);
        }
    }
    if let Some(h) = &handle {
        prompt_template = prompt_template.replace("${handle}", h);
    }

    let alias_prefix = alias_awareness_prefix(&db_path, handle.as_deref());
    if !alias_prefix.is_empty() {
        prompt_template = format!("{alias_prefix}{prompt_template}");
    }

    let prompt = if prompt_template.contains("{}") {
        prompt_template.replace("{}", &transcript)
    } else {
        format!("{}\n\nTranscript:\n{}", prompt_template, transcript)
    };

    // Configurable per Settings (enhancement #3: models get renamed/deprecated on Venice's end
    // over time — e.g. "GLM 5.1" vs "GLM 5.2" — so this shouldn't be a hardcoded constant the
    // user has no way to update themselves).
    let model = db::get_setting(&db_path, "venice_model")
        .unwrap_or(None)
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_VENICE_MODEL.to_string());

    let client = reqwest::Client::new();
    let result = call_venice_api(&client, &route, &model, &prompt).await?;
    Ok(post_process(&db_path, result))
}

/// When "Enable Alias Awareness" is on (Settings > Plugins > Venice), prepends a short note to the
/// cloud prompt if the channel's biography row has a non-empty `alias` — skipped when the setting
/// is off, there's no handle, or no alias is stored.
fn alias_awareness_prefix(db_path: &str, handle: Option<&str>) -> String {
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return String::new();
    };
    if !db::get_setting_bool(&conn, "aliasAwarenessEnabled") {
        return String::new();
    }
    let Some(h) = handle else {
        return String::new();
    };
    let Ok(Some(bio)) = db::get_biography_by_handle(db_path, h) else {
        return String::new();
    };
    let alias = bio.14.trim();
    if alias.is_empty() {
        return String::new();
    }
    format!(
        "This channel is also known by {alias}\n Use this alias to help identify and correctly spell names mentioned in the transcript.\n\n"
    )
}

/// Applies whichever "Post-Processing Options" (Settings > API Key > Venice) are turned on to a
/// freshly generated Venice summary, before it's ever shown or saved — not on every save any more
/// (see db/summaries.rs's doc comments on the two functions below), and not applied to an
/// Ollama-generated or hand-edited summary at all, since Venice is the one known to emit the
/// markdown patterns (redundant blockquote quoting, leading emoji) these clean up.
fn post_process(db_path: &str, text: String) -> String {
    let Ok(conn) = rusqlite::Connection::open(db_path) else { return text };
    let mut out = text;
    if db::get_setting_bool(&conn, "stripQuoteblockQuotes") {
        out = db::strip_quoteblock_quotes(&out);
    }
    if db::get_setting_bool(&conn, "stripHeaderEmojis") {
        out = db::strip_header_and_paragraph_emojis(&out);
    }
    out
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VeniceImageRequest {
    pub model: String,
    pub prompt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub steps: Option<u32>,
    pub seed: Option<i64>,
    pub format: Option<String>,
    pub safe_mode: Option<bool>,
    pub hide_watermark: Option<bool>,
    pub resolution: Option<String>,
    pub return_binary: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct VeniceImageResponse {
    pub images: Option<Vec<String>>,
    pub data: Option<Vec<VeniceImageData>>,
}

#[derive(Debug, Deserialize)]
pub struct VeniceImageData {
    #[serde(rename = "b64_json")]
    pub b64_json: Option<String>,
    pub url: Option<String>,
}

/// Generates an image from `prompt` via the Venice image API and returns either a base64 data
/// URI or a direct URL, depending on which shape the response uses (Venice's own "images" array
/// format, or an OpenAI-compatible "data" array with b64_json/url — both are checked in order).
pub async fn generate_image(app: AppHandle, prompt: String) -> Result<String, String> {
    let db_path = get_db_path(&app);
    
    let route = license::route(&db_path, "venice")
        .ok_or("Venice API key not found. Please set it in Settings.")?;

    let request_body = VeniceImageRequest {
        model: "nano-banana-pro".to_string(),
        prompt,
        width: Some(1024),
        height: Some(1024),
        steps: Some(25),
        seed: Some(0),
        format: Some("png".to_string()),
        safe_mode: Some(false),
        hide_watermark: Some(true),
        resolution: Some("1K".to_string()),
        return_binary: Some(false),
    };

    let client = reqwest::Client::new();
    let response = route
        .apply(client.post(route.url("image/generate")))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Venice image API request failed: {}", e))?;

    let status = response.status();
    let error_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Venice image API error: {} - {}", status, error_text));
    }

    let result: VeniceImageResponse = serde_json::from_str(&error_text)
        .map_err(|e| format!("Failed to parse Venice image response: {}. Response was: {}", e, error_text))?;

    // Try new format first (images array)
    if let Some(images) = result.images {
        if let Some(base64_image) = images.into_iter().next() {
            return Ok(format!("data:image/png;base64,{}", base64_image));
        }
    }

    // Try OpenAI-compatible format (data array with b64_json)
    if let Some(data) = result.data {
        if let Some(first) = data.into_iter().next() {
            if let Some(b64) = first.b64_json {
                return Ok(format!("data:image/png;base64,{}", b64));
            }
            if let Some(url) = first.url {
                return Ok(url);
            }
        }
    }

    Err("No image generated in response".to_string())
}

#[cfg(test)]
mod tests {
    use super::alias_awareness_prefix;
    use rusqlite::{params, Connection};

    fn db_with_bio(alias: &str) -> String {
        let path = std::env::temp_dir()
            .join(format!(
                "kinesis_venice_alias_{}_{}.db",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .to_string_lossy()
            .to_string();
        crate::db::init_db(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO Biographies (handle, display_name, alias) VALUES ('@Creator', 'Current Name', ?1)",
            params![alias],
        )
        .unwrap();
        path
    }

    fn set_alias_awareness(path: &str, on: bool) {
        Connection::open(path)
            .unwrap()
            .execute(
                "INSERT INTO Settings (key, value) VALUES ('aliasAwarenessEnabled', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![if on { "true" } else { "false" }],
            )
            .unwrap();
    }

    #[test]
    fn alias_prefix_when_enabled_and_alias_present() {
        let path = db_with_bio("Former Name");
        set_alias_awareness(&path, true);
        let msg = alias_awareness_prefix(&path, Some("@Creator"));
        assert!(msg.contains("Former Name"));
        assert!(msg.contains("also known by"));
    }

    #[test]
    fn alias_prefix_empty_when_disabled_or_missing_alias() {
        let path = db_with_bio("");
        set_alias_awareness(&path, true);
        assert!(alias_awareness_prefix(&path, Some("@Creator")).is_empty());

        let path2 = db_with_bio("Former Name");
        set_alias_awareness(&path2, false);
        assert!(alias_awareness_prefix(&path2, Some("@Creator")).is_empty());
        assert!(alias_awareness_prefix(&path2, None).is_empty());
    }
}