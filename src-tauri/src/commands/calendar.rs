//! The Calendar's commands (see db/calendar.rs). `today` is the day on the user's clock, as the page sees it ("2026-09-07");
//! left out, it's this computer's.

use crate::{db, get_db_path};
use chrono::{Datelike, NaiveDate};
use tauri::command;

// Every command runs on a blocking thread: a plain (non-async) command would run on the main thread and freeze the window
// while it waits on the database.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn day(today: Option<String>) -> NaiveDate {
    today
        .and_then(|t| NaiveDate::parse_from_str(t.trim(), "%Y-%m-%d").ok())
        .unwrap_or_else(db::local_today)
}

/// Every track and where each stands today.
#[command]
pub async fn list_calendar_tracks(app: tauri::AppHandle, include_archived: Option<bool>, today: Option<String>) -> Result<Vec<db::TrackSummary>, String> {
    let db_path = get_db_path(&app);
    let today = day(today);
    blocking(move || db::list_calendar_tracks(&db_path, include_archived.unwrap_or(false), today)).await
}

/// What's on each day from `from` to `to` ("2026-09-07"), across the tracks that aren't archived.
#[command]
pub async fn list_calendar_days(app: tauri::AppHandle, from: String, to: String, today: Option<String>) -> Result<Vec<db::DayItem>, String> {
    let db_path = get_db_path(&app);
    let parse = |s: &str| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| format!("'{s}' isn't a date like 2026-09-07"));
    let (from, to, today) = (parse(&from)?, parse(&to)?, day(today));
    if (to - from).num_days() > 400 {
        return Err("That's too many days to show at once.".into());
    }
    blocking(move || db::list_calendar_days(&db_path, from, to, today)).await
}

/// Exports the chosen tracks' schedules from `from` to `to` as an .ics file (see db::export_calendar_ics), asking where to
/// save it. The path it was saved to, or None when the save was cancelled.
#[command]
pub async fn export_calendar_ics(
    app: tauri::AppHandle,
    track_ids: Vec<i64>,
    from: String,
    to: String,
    today: Option<String>,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let parse = |s: &str| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| format!("'{s}' isn't a date like 2026-09-07"));
    let (from, to, today) = (parse(&from)?, parse(&to)?, day(today));
    // The Export window checks both of these too (CalendarView.tsx's ExportModal).
    if to < from {
        return Err("The To date can't be before the From date.".into());
    }
    if (to - from).num_days() > 2 * 366 {
        return Err("Pick a period of up to two years.".into());
    }
    let db_path = get_db_path(&app);
    let ics = blocking(move || db::export_calendar_ics(&db_path, &track_ids, from, to, today)).await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Export to Calendar")
        .set_file_name(file_name)
        .add_filter("iCalendar (.ics)", &["ics"])
        .save_file(move |f| {
            let _ = tx.send(f.map(|p| p.to_string()));
        });
    match rx.await.map_err(|e| e.to_string())? {
        Some(path) => {
            std::fs::write(&path, ics).map_err(|e| e.to_string())?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// One track in full: where it stands, its terms and its holiday rules.
#[command]
pub async fn get_calendar_track(app: tauri::AppHandle, id: i64, today: Option<String>) -> Result<db::TrackDetail, String> {
    let db_path = get_db_path(&app);
    let today = day(today);
    blocking(move || db::get_calendar_track(&db_path, id, today)).await
}

#[command]
pub async fn create_calendar_track(app: tauri::AppHandle, input: db::TrackInput) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::create_calendar_track(&db_path, &input)).await
}

#[command]
pub async fn update_calendar_track(app: tauri::AppHandle, id: i64, input: db::TrackInput) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::update_calendar_track(&db_path, id, &input)).await
}

#[command]
pub async fn set_calendar_track_archived(app: tauri::AppHandle, id: i64, archived: bool) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_calendar_track_archived(&db_path, id, archived)).await
}

/// Starts a track over from today: its first entry again, in a new first round, with what was done before kept as history.
#[command]
pub async fn start_calendar_track_over(app: tauri::AppHandle, id: i64, today: Option<String>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let today = day(today);
    blocking(move || db::start_calendar_track_over(&db_path, id, today)).await
}

/// Undoes a track's last Start over: back to the start date and run it had before.
#[command]
pub async fn undo_calendar_track_start_over(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::undo_calendar_track_start_over(&db_path, id)).await
}

#[command]
pub async fn delete_calendar_track(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::delete_calendar_track(&db_path, id)).await
}

fn extras(icon: Option<String>, description: Option<String>, priority: Option<i64>) -> db::EntryExtras {
    db::EntryExtras { icon: icon.unwrap_or_default(), description: description.unwrap_or_default(), priority: priority.unwrap_or(0) }
}

/// Adds a video (or, with none, a task with its label) to the end of a track, with its icon, description and priority
/// (0 none to 3 high) if given.
#[command]
pub async fn add_calendar_entry(
    app: tauri::AppHandle,
    track_id: i64,
    video_id: Option<String>,
    label: Option<String>,
    icon: Option<String>,
    description: Option<String>,
    priority: Option<i64>,
) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    let extras = extras(icon, description, priority);
    blocking(move || db::add_calendar_entry(&db_path, track_id, video_id.as_deref(), label.as_deref().unwrap_or(""), &extras)).await
}

#[command]
pub async fn update_calendar_entry(
    app: tauri::AppHandle,
    id: i64,
    label: String,
    target_date: Option<String>,
    icon: Option<String>,
    description: Option<String>,
    priority: Option<i64>,
) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let extras = extras(icon, description, priority);
    blocking(move || db::update_calendar_entry(&db_path, id, &label, target_date.as_deref(), &extras)).await
}

#[command]
pub async fn remove_calendar_entry(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::remove_calendar_entry(&db_path, id)).await
}

#[command]
pub async fn set_calendar_entry_order(app: tauri::AppHandle, track_id: i64, entry_ids: Vec<i64>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_calendar_entry_order(&db_path, track_id, &entry_ids)).await
}

/// Adds an empty folder to the end of a track (entries are dragged into it).
#[command]
pub async fn add_calendar_folder(app: tauri::AppHandle, track_id: i64, name: String) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::add_calendar_folder(&db_path, track_id, &name, &db::EntryExtras::default())).await
}

/// One entry's place in a new layout: its id, and the folder it's in (none for the top level).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPlace {
    id: i64,
    folder_id: Option<i64>,
}

/// Lays a track's entries out anew (the panel's drag and drop): every entry, in reading order, each with its folder.
#[command]
pub async fn set_calendar_entry_layout(app: tauri::AppHandle, track_id: i64, layout: Vec<EntryPlace>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let layout: Vec<(i64, Option<i64>)> = layout.into_iter().map(|p| (p.id, p.folder_id)).collect();
    blocking(move || db::set_calendar_entry_layout(&db_path, track_id, &layout)).await
}

/// Marks an entry done (or not) in a loop cycle. On a track that follows a Drive's sequence, an entry can be named by its
/// video instead.
#[command]
pub async fn set_calendar_completion(
    app: tauri::AppHandle,
    track_id: i64,
    entry_id: Option<i64>,
    video_id: Option<String>,
    cycle: Option<i64>,
    done: bool,
) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_calendar_completion(&db_path, track_id, entry_id, video_id.as_deref(), cycle.unwrap_or(0), done)).await
}

/// Marks an entry In progress in a cycle, or takes the mark off (started, not finished). Named like a completion.
#[command]
pub async fn set_calendar_progress(
    app: tauri::AppHandle,
    track_id: i64,
    entry_id: Option<i64>,
    video_id: Option<String>,
    cycle: Option<i64>,
    on: bool,
) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_calendar_progress(&db_path, track_id, entry_id, video_id.as_deref(), cycle.unwrap_or(0), on)).await
}

#[command]
pub async fn add_calendar_term(app: tauri::AppHandle, track_id: i64, name: String, start_date: String, end_date: String, annual: bool) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::add_calendar_term(&db_path, track_id, &name, &start_date, &end_date, annual)).await
}

#[command]
pub async fn remove_calendar_term(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::remove_calendar_term(&db_path, id)).await
}

/// Every holiday set, with the built-in one's dates worked out for `year` (this year when left out).
#[command]
pub async fn list_calendar_holiday_sets(app: tauri::AppHandle, year: Option<i32>) -> Result<Vec<db::HolidaySet>, String> {
    let db_path = get_db_path(&app);
    let year = year.unwrap_or_else(|| db::local_today().year());
    blocking(move || db::list_calendar_holiday_sets(&db_path, year)).await
}

#[command]
pub async fn create_calendar_holiday_set(app: tauri::AppHandle, name: String, annual: bool) -> Result<i64, String> {
    let db_path = get_db_path(&app);
    blocking(move || db::create_calendar_holiday_set(&db_path, &name, annual)).await
}

#[command]
pub async fn delete_calendar_holiday_set(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::delete_calendar_holiday_set(&db_path, id)).await
}

#[command]
pub async fn add_calendar_holiday_date(app: tauri::AppHandle, set_id: i64, date: String, name: Option<String>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::add_calendar_holiday_date(&db_path, set_id, &date, name.as_deref().unwrap_or(""))).await
}

#[command]
pub async fn remove_calendar_holiday_date(app: tauri::AppHandle, set_id: i64, date: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::remove_calendar_holiday_date(&db_path, set_id, &date)).await
}

/// Has a track exclude or include a holiday set; with no `mode`, neither.
#[command]
pub async fn set_calendar_track_holiday_rule(app: tauri::AppHandle, track_id: i64, set_id: i64, mode: Option<String>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    blocking(move || db::set_calendar_track_holiday_rule(&db_path, track_id, set_id, mode.as_deref())).await
}
