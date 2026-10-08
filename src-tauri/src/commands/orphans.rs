//! Catching a saved video up with YouTube when it's opened (see db/orphans.rs): a new title is taken over, and a video
//! YouTube no longer has is marked orphaned. Asked of YouTube's player endpoint, so no API key is needed.

use crate::youtube::{ClientType, YouTubeClient};
use crate::{db, get_db_path};
use serde::Serialize;
use serde_json::Value;
use tauri::command;

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// What YouTube's answer says about a video.
#[derive(Debug, PartialEq)]
enum Found {
    /// It's there, under this title.
    Title(String),
    /// It's gone, for this reason ("Video unavailable", "This video is private").
    Gone(String),
    /// Anything else (a sign-in or bot check, an age gate, no answer): nothing can be told from it.
    Unknown,
}

/// Reads the player endpoint's answer. A title means the video exists, even when it can't be played here (that's
/// usual without a browser). Only a plain ERROR with no video in it, or a private video, counts as gone: a sign-in
/// check is about the asker, not the video, so it never orphans one.
fn read_player(data: &Value) -> Found {
    if let Some(title) = data["videoDetails"]["title"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
        return Found::Title(title.to_string());
    }
    let status = data["playabilityStatus"]["status"].as_str().unwrap_or("");
    let reason = data["playabilityStatus"]["reason"].as_str().unwrap_or("").trim().to_string();
    let private = reason.to_lowercase().contains("private");
    match status {
        "ERROR" => Found::Gone(if reason.is_empty() { "Video unavailable".into() } else { reason }),
        "LOGIN_REQUIRED" if private => Found::Gone(reason),
        _ => Found::Unknown,
    }
}

/// What opening a video found: `status` is "ok", "orphaned" or "unknown"; a renamed video's old and new titles.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoIdentityCheck {
    pub status: String,
    pub old_title: Option<String>,
    pub new_title: Option<String>,
    pub reason: Option<String>,
}

/// Asks YouTube about a saved video and catches it up: a new title is stored (the old one is returned, for the sidebar
/// to say so), a video that's gone is marked orphaned (its title is left as it was), and one that answers again stops
/// being orphaned.
#[command]
pub async fn check_video_identity(app: tauri::AppHandle, video_id: String) -> Result<VideoIdentityCheck, String> {
    let db_path = get_db_path(&app);
    let data = YouTubeClient::new(ClientType::Web).player(&video_id).await?;
    match read_player(&data) {
        Found::Title(title) => {
            let (path, id, t) = (db_path.clone(), video_id.clone(), title.clone());
            let old = blocking(move || {
                db::set_orphaned(&path, &id, false, "")?;
                db::update_video_title(&path, &id, &t)
            })
            .await?;
            Ok(VideoIdentityCheck { status: "ok".into(), new_title: old.as_ref().map(|_| title), old_title: old, reason: None })
        }
        Found::Gone(reason) => {
            let r = reason.clone();
            blocking(move || db::set_orphaned(&db_path, &video_id, true, &r)).await?;
            Ok(VideoIdentityCheck { status: "orphaned".into(), reason: Some(reason), ..Default::default() })
        }
        Found::Unknown => Ok(VideoIdentityCheck { status: "unknown".into(), ..Default::default() }),
    }
}

/// Where the reader left a saved video (the sidebar's Resume), if anywhere.
#[command]
pub async fn get_video_position(app: tauri::AppHandle, video_id: String) -> Result<Option<db::VideoPosition>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::get_video_position(&db_path, &video_id)).await
}

/// Records where the reader is in a saved video; 0 forgets it (played to the end).
#[command]
pub async fn set_video_position(app: tauri::AppHandle, video_id: String, seconds: f64, duration: Option<f64>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_video_position(&db_path, &video_id, seconds, duration)).await
}

/// The pin menu's Continue Watching: saved videos started and not finished.
#[command]
pub async fn list_continue_watching(app: tauri::AppHandle) -> Result<Vec<db::ListedVideo>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_continue_watching(&db_path)).await
}

/// The pin menu's Watched: every video marked watched.
#[command]
pub async fn list_watched_videos(app: tauri::AppHandle) -> Result<Vec<db::ListedVideo>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_watched(&db_path)).await
}

/// Marks a saved video watched or not (a video that plays to its end is marked by the sidebar).
#[command]
pub async fn set_video_watched(app: tauri::AppHandle, video_id: String, watched: bool) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_video_watched(&db_path, &video_id, watched)).await
}

/// Continue Watching's Mark as Completed: the video is watched (out of Continue Watching), and done on every track it's
/// on. `today` is the app's local date. Returns how many track entries it checked off.
#[command]
pub async fn complete_video(app: tauri::AppHandle, video_id: String, today: String) -> Result<usize, String> {
    let db_path = get_db_path(&app);
    let today = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").map_err(|e| e.to_string())?;
    blocking(move || {
        db::set_video_watched(&db_path, &video_id, true)?;
        db::complete_video_on_tracks(&db_path, &video_id, today)
    })
    .await
}

/// The Orphaned window's list.
#[command]
pub async fn list_orphaned_videos(app: tauri::AppHandle) -> Result<Vec<db::OrphanedVideo>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_orphaned(&db_path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_title_means_its_there_and_only_a_plain_error_or_private_means_its_gone() {
        // Shapes taken from real answers (a live video can't be played without a browser, but its title comes back).
        let live = json!({ "playabilityStatus": { "status": "UNPLAYABLE", "reason": "Video unavailable" }, "videoDetails": { "title": "Never Gonna Give You Up" } });
        assert_eq!(read_player(&live), Found::Title("Never Gonna Give You Up".into()));
        let removed = json!({ "playabilityStatus": { "status": "ERROR", "reason": "Video unavailable" } });
        assert_eq!(read_player(&removed), Found::Gone("Video unavailable".into()));
        let private = json!({ "playabilityStatus": { "status": "LOGIN_REQUIRED", "reason": "This video is private" } });
        assert_eq!(read_player(&private), Found::Gone("This video is private".into()));
        let bot_check = json!({ "playabilityStatus": { "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you're not a bot" } });
        assert_eq!(read_player(&bot_check), Found::Unknown);
        assert_eq!(read_player(&json!({})), Found::Unknown);
    }
}
