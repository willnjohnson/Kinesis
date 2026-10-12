//! The commands for Workbooks (db/workbooks.rs) and Logs (db/logs.rs).

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

/// Every workbook, shared and personal, by name, each with its notes in order.
#[command]
pub async fn list_workbooks(app: tauri::AppHandle) -> Result<Vec<db::Workbook>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_workbooks(&db_path)).await
}

#[command]
pub async fn get_workbook(app: tauri::AppHandle, id: String) -> Result<Option<db::Workbook>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::get_workbook(&db_path, &id)).await
}

#[command]
pub async fn create_workbook(app: tauri::AppHandle, shared: bool, title: String) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::create_workbook(&db_path, shared, &title)).await
}

#[command]
pub async fn rename_workbook(app: tauri::AppHandle, id: String, title: String) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::rename_workbook(&db_path, &id, &title)).await
}

/// Makes a workbook shared or personal. `with_notes`: its notes go with it, all in one step. Without it, sharing a
/// workbook that holds personal notes is refused.
#[command]
pub async fn set_workbook_shared(app: tauri::AppHandle, id: String, shared: bool, with_notes: Option<bool>) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_workbook_shared(&db_path, &id, shared, with_notes.unwrap_or(false))).await
}

/// Deletes a workbook. Its notes stay.
#[command]
pub async fn delete_workbook(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::delete_workbook(&db_path, &id)).await
}

/// Adds a note to the end of a workbook. A personal note isn't taken into a shared one (the message says to share it).
#[command]
pub async fn add_note_to_workbook(app: tauri::AppHandle, id: String, note_id: String) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::add_note_to_workbook(&db_path, &id, &note_id)).await
}

#[command]
pub async fn remove_note_from_workbook(app: tauri::AppHandle, id: String, note_id: String) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::remove_note_from_workbook(&db_path, &id, &note_id)).await
}

#[command]
pub async fn reorder_workbook(app: tauri::AppHandle, id: String, order: Vec<String>) -> Result<db::Workbook, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::reorder_workbook(&db_path, &id, &order)).await
}

/// Adds a workbook's notes to the end of a Calendar track, in the workbook's order: all of them, or from `from_page`
/// (1 for the first) on. Returns how many were added (the ones already on the track are left where they are).
#[command]
pub async fn add_calendar_workbook(app: tauri::AppHandle, track_id: i64, workbook_id: String, from_page: Option<usize>) -> Result<usize, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::add_calendar_workbook(&db_path, track_id, &workbook_id, from_page)).await
}

/// Every log, the ones with entries first.
#[command]
pub async fn list_logs(app: tauri::AppHandle) -> Result<Vec<db::Log>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_logs(&db_path)).await
}

#[command]
pub async fn create_log(app: tauri::AppHandle, name: String) -> Result<db::Log, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::create_log(&db_path, &name)).await
}

#[command]
pub async fn rename_log(app: tauri::AppHandle, id: String, name: String) -> Result<db::Log, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::rename_log(&db_path, &id, &name)).await
}

/// Turns a log's bell on or off (the pin menu's reminder on a day it hasn't been written in).
#[command]
pub async fn set_log_remind(app: tauri::AppHandle, id: String, remind: bool) -> Result<db::Log, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_log_remind(&db_path, &id, remind)).await
}

/// Sets (or, all empty, clears) what a day's Entry starts as in a log.
#[command]
pub async fn set_log_entry_template(app: tauri::AppHandle, id: String, template: db::EntryTemplate) -> Result<db::Log, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_log_entry_template(&db_path, &id, &template)).await
}

/// The logs with their bell on that have nothing written for `today` (the reader's own day, which the app passes).
#[command]
pub async fn list_logs_due(app: tauri::AppHandle, today: String) -> Result<Vec<db::Log>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_logs_due(&db_path, &today)).await
}

/// Deletes a log and everything written in it.
#[command]
pub async fn delete_log(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::delete_log(&db_path, &id)).await
}

#[command]
pub async fn list_log_entries(app: tauri::AppHandle, log_id: String) -> Result<Vec<db::LogEntry>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::list_log_entries(&db_path, &log_id)).await
}

/// Writes a log's day (its one row): made, changed, or removed when both are left empty (None).
#[command]
pub async fn write_log_day(app: tauri::AppHandle, log_id: String, date: String, title: String, description: String) -> Result<Option<db::LogEntry>, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::write_log_day(&db_path, &log_id, &date, &title, &description)).await
}
