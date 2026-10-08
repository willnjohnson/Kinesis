//! The pin menu's commands (see db/pins.rs).

use crate::{db, get_db_path};
use tauri::command;

// On a blocking thread, as the other database commands are, so the window doesn't wait on the database.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// The pinned videos, newest pin first.
#[command]
pub async fn list_pins(app: tauri::AppHandle) -> Result<Vec<db::MenuVideo>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_pins(&db_path)).await
}

/// Pins or unpins a video saved to the library.
#[command]
pub async fn set_pinned(app: tauri::AppHandle, video_id: String, pinned: bool) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_pinned(&db_path, &video_id, pinned)).await
}

/// Unpins everything.
#[command]
pub async fn clear_pins(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::clear_pins(&db_path)).await
}

/// The graph view's nodes and edges (db/graph.rs). Kept here with the pin menu's: both are small reads for one view.
#[command]
pub async fn get_link_graph(app: tauri::AppHandle) -> Result<db::LinkGraph, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::link_graph(&db_path)).await
}

/// The saved videos carrying a tag (an Essential tag's submenu).
#[command]
pub async fn list_videos_with_tag(app: tauri::AppHandle, tag: String) -> Result<Vec<db::MenuVideo>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_videos_with_tag(&db_path, &tag)).await
}
