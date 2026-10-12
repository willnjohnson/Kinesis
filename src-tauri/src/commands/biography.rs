use crate::{db, get_db_path};
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiographyEntry {
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub wikipedia: String,
    pub website: String,
    pub twitter: String,
    pub instagram: String,
    pub facebook: String,
    pub threads: String,
    pub youtube: String,
    pub tiktok: String,
    pub twitch: String,
    pub reddit: String,
    pub discord: String,
    /// The reader's own name for the channel ("" when there's none).
    pub alias: String,
}

fn map_row(row: db::BiographyRow) -> BiographyEntry {
    BiographyEntry {
        handle: row.0,
        display_name: row.1,
        bio: row.2,
        wikipedia: row.3,
        website: row.4,
        twitter: row.5,
        instagram: row.6,
        facebook: row.7,
        threads: row.8,
        youtube: row.9,
        tiktok: row.10,
        twitch: row.11,
        reddit: row.12,
        discord: row.13,
        alias: row.14,
    }
}

#[command]
pub fn get_biographies(app: tauri::AppHandle) -> Result<Vec<BiographyEntry>, String> {
    let db_path = get_db_path(&app);
    let rows = db::get_biographies(&db_path).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(map_row).collect())
}

#[command]
pub fn get_biography(app: tauri::AppHandle, handle: String) -> Result<Option<BiographyEntry>, String> {
    let db_path = get_db_path(&app);
    let row = db::get_biography_by_handle(&db_path, &handle).map_err(|e| e.to_string())?;
    Ok(row.map(map_row))
}

#[command]
#[allow(clippy::too_many_arguments)]
pub fn update_biography(
    app: tauri::AppHandle,
    handle: String,
    bio: String,
    wikipedia: String,
    website: String,
    twitter: String,
    instagram: String,
    facebook: String,
    threads: String,
    youtube: String,
    tiktok: String,
    twitch: String,
    reddit: String,
    discord: String,
    alias: Option<String>,
) -> Result<(), String> {
    let db_path = get_db_path(&app);
    db::update_biography_details(
        &db_path,
        &handle,
        &bio,
        &wikipedia,
        &website,
        &twitter,
        &instagram,
        &facebook,
        &threads,
        &youtube,
        &tiktok,
        &twitch,
        &reddit,
        &discord,
        alias.as_deref().unwrap_or(""),
    )
    .map_err(|e| e.to_string())
}

/// What `check_channel_identity` found: the handle the biography goes by now (`renamedFrom` set when it just changed),
/// and, when the channel's name changed on YouTube, the old and new names, for the window to ask about keeping the
/// old one as an alias.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelIdentityCheck {
    pub handle: String,
    pub renamed_from: Option<String>,
    pub new_display_name: Option<String>,
    pub old_display_name: Option<String>,
    /// The channel's subscriber count now, when it had changed since it was stored (already saved).
    pub subscriber_count: Option<i64>,
}

/// Looks the channel up by its channel ID (which never changes) on its public YouTube page, no API key needed, and
/// catches the biography up: a new handle is taken over right away; a new name is only reported, since the window asks
/// first. Nothing changes when the biography has no channel ID or the page doesn't say.
#[command]
pub async fn check_channel_identity(app: tauri::AppHandle, handle: String) -> Result<ChannelIdentityCheck, String> {
    let db_path = get_db_path(&app);
    let mut out = ChannelIdentityCheck { handle: handle.clone(), renamed_from: None, new_display_name: None, old_display_name: None, subscriber_count: None };
    let found = {
        let path = db_path.clone();
        let h = handle.clone();
        tauri::async_runtime::spawn_blocking(move || db::get_biography_channel_id(&path, &h)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?
    };
    let Some((stored, mut channel_id, display_name)) = found else { return Ok(out) };
    out.handle = stored.clone();
    // Never captured (an older biography): found from the handle now, while it still leads to the channel, and kept.
    if channel_id.trim().is_empty() {
        let Some(id) = crate::youtube::extract_channel_id(&stored).await? else { return Ok(out) };
        let (path, h, id2) = (db_path.clone(), stored.clone(), id.clone());
        tauri::async_runtime::spawn_blocking(move || db::set_biography_channel_id(&path, &h, &id2))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        channel_id = id;
    }
    let Some((now_handle, now_name, subscribers)) = crate::youtube::fetch_channel_identity(channel_id.trim()).await? else { return Ok(out) };

    let bare = |h: &str| h.trim().trim_start_matches('@').to_lowercase();
    if bare(&now_handle) != bare(&stored) {
        let (path, old, new) = (db_path.clone(), stored.clone(), now_handle.clone());
        let renamed = tauri::async_runtime::spawn_blocking(move || db::rename_biography_handle(&path, &old, &new))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        if renamed {
            out.renamed_from = Some(stored);
            out.handle = now_handle;
        }
    }
    // A name saved as "Name (@handle)" (how some come in with a video) is the same name as "Name".
    let bare_name = |n: &str| {
        let n = n.trim();
        match n.rfind(" (@") {
            Some(at) if n.ends_with(')') => n[..at].trim().to_string(),
            _ => n.to_string(),
        }
    };
    if !display_name.trim().is_empty() && bare_name(&now_name) != bare_name(&display_name) {
        out.old_display_name = Some(display_name.trim().to_string());
        out.new_display_name = Some(now_name);
    }
    // Its subscriber count, from the same page, under the handle it goes by now. Stored without a word: it has
    // usually moved. A page that shows none (a hidden count) leaves what's stored.
    if let Some(count) = subscribers {
        let (path, h) = (db_path.clone(), out.handle.clone());
        out.subscriber_count = tauri::async_runtime::spawn_blocking(move || db::update_biography_subscribers(&path, &h, count))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// The window's answer to a renamed channel: take the new name, keeping the old one as the alias or not.
#[command]
pub async fn rename_biography_display_name(app: tauri::AppHandle, handle: String, name: String, keep_old_as_alias: bool) -> Result<(), String> {
    let db_path = get_db_path(&app);
    tauri::async_runtime::spawn_blocking(move || db::rename_biography_display_name(&db_path, &handle, &name, keep_old_as_alias))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Edit Bio's Handle tab: the same handle with different capitals (@john to @John), never a different one. Everything
/// that knows the channel by its handle follows, as when YouTube renames it (db::rename_biography_handle).
#[command]
pub async fn set_biography_handle_case(app: tauri::AppHandle, handle: String, new_handle: String) -> Result<String, String> {
    let new_handle = db::handle_case_change(&handle, &new_handle)?;
    let db_path = get_db_path(&app);
    let (old, new) = (handle.clone(), new_handle.clone());
    let renamed = tauri::async_runtime::spawn_blocking(move || db::rename_biography_handle(&db_path, &old, &new))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if !renamed {
        return Err("Another biography already has that handle.".into());
    }
    Ok(new_handle)
}
