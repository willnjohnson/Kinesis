//! The Notes section's commands (see db/notes.rs).

use crate::{db, get_db_path, trash};
use tauri::command;

// On a blocking thread, as the other database commands are, so the window doesn't wait on the database.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// Every note, shared and personal, the most recently changed first.
#[command]
pub async fn list_notes(app: tauri::AppHandle) -> Result<Vec<db::Note>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_notes(&db_path)).await
}

/// One note, or None when it's gone.
#[command]
pub async fn get_note(app: tauri::AppHandle, id: String) -> Result<Option<db::Note>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::get_note(&db_path, &id)).await
}

#[command]
pub async fn create_note(app: tauri::AppHandle, shared: bool, title: String, body: String, drives: Vec<String>) -> Result<db::Note, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::create_note(&db_path, shared, &title, &body, &drives)).await
}

#[command]
pub async fn update_note(app: tauri::AppHandle, id: String, title: String, body: String, drives: Vec<String>) -> Result<db::Note, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::update_note(&db_path, &id, &title, &body, &drives)).await
}

/// Adds a paragraph (a citation) to the end of a note.
#[command]
pub async fn append_to_note(app: tauri::AppHandle, id: String, text: String) -> Result<db::Note, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::append_to_note(&db_path, &id, &text)).await
}

/// Makes a note shared or personal.
#[command]
pub async fn set_note_shared(app: tauri::AppHandle, id: String, shared: bool) -> Result<db::Note, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_note_shared(&db_path, &id, shared)).await
}

/// Deletes a note to the Trash. Returns its Trash id (None if there was no such note).
#[command]
pub async fn delete_note(app: tauri::AppHandle, id: String) -> Result<Option<u64>, String> {
    let db_path = get_db_path(&app);
    tokio::task::spawn_blocking(move || trash::delete_note(trash::store(&app), &db_path, &id)).await.map_err(|e| e.to_string())?
}
