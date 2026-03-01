use rusqlite::{params, Connection, Result};
use crate::Video;

pub fn init_db(db_path: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS videos (
            video_id TEXT PRIMARY KEY,
            title TEXT,
            author TEXT,
            handle TEXT,
            length_seconds INTEGER,
            transcript TEXT,
            view_count TEXT,
            published_at TEXT,
            video_type TEXT DEFAULT 'standard',
            date_added DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Try to add video_type column if it doesn't exist (for existing databases)
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use a workaround
    let column_exists: i32 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'video_type'",
        [],
        |row| row.get(0),
    )?;
    
    if column_exists == 0 {
        let _ = conn.execute(
            "ALTER TABLE videos ADD COLUMN video_type TEXT DEFAULT 'standard'",
            [],
        );
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )?;
    Ok(())
}

pub fn list_videos(db_path: &str, video_type_filter: Option<&str>) -> Result<Vec<Video>> {
    let conn = Connection::open(db_path)?;
    
    let query = match video_type_filter {
        Some("short") => "SELECT video_id, title, author, length_seconds, view_count, published_at, date_added, handle, video_type FROM videos WHERE video_type = 'short' ORDER BY date_added DESC, rowid DESC",
        Some("standard") => "SELECT video_id, title, author, length_seconds, view_count, published_at, date_added, handle, video_type FROM videos WHERE video_type = 'standard' ORDER BY date_added DESC, rowid DESC",
        _ => "SELECT video_id, title, author, length_seconds, view_count, published_at, date_added, handle, video_type FROM videos ORDER BY date_added DESC, rowid DESC",
    };
    
    let mut stmt = conn.prepare(query)?;
    let video_iter = stmt.query_map([], |row| {
        Ok(Video {
            id: row.get(0)?,
            title: row.get(1)?,
            author: Some(row.get(2)?),
            length_seconds: row.get::<_, Option<i32>>(3)?,
            view_count: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Saved".to_string()),
            thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", row.get::<_, String>(0)?),
            published_at: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "".to_string()),
            status: Some("saved".to_string()),
            date_added: row.get::<_, Option<String>>(6)?,
            handle: row.get::<_, Option<String>>(7)?,
            video_type: row.get::<_, Option<String>>(8)?,
        })
    })?;

    let mut videos = Vec::new();
    for video in video_iter {
        videos.push(video?);
    }
    Ok(videos)
}

pub fn save_video(db_path: &str, video_id: &str, title: &str, author: &str, length: i32, transcript: &str, view_count: &str, published_at: &str, handle: &str, video_type: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO videos (video_id, title, author, length_seconds, transcript, view_count, published_at, handle, video_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(video_id) DO UPDATE SET 
            title=excluded.title, 
            author=excluded.author, 
            length_seconds=excluded.length_seconds, 
            transcript=excluded.transcript,
            view_count=excluded.view_count,
            published_at=excluded.published_at,
            handle=excluded.handle,
            video_type=excluded.video_type",
        params![video_id, title, author, length, transcript, view_count, published_at, handle, video_type],
    )?;
    Ok(())
}

pub fn delete_video(db_path: &str, video_id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM videos WHERE video_id = ?", params![video_id])?;
    Ok(())
}

pub fn check_video_exists(db_path: &str, video_id: &str) -> Result<bool> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT 1 FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    Ok(rows.next()?.is_some())
}

pub fn get_transcript(db_path: &str, video_id: &str) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT transcript FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn get_video_full(db_path: &str, video_id: &str) -> Result<Option<(String, String, String, i32, String, String, String, String, String)>> {
     let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT video_id, title, author, length_seconds, transcript, view_count, published_at, handle, video_type FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "".to_string()),
            row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "".to_string()),
            row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "".to_string()),
            row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "standard".to_string())
        )))
    } else {
        Ok(None)
    }
}

pub fn vacuum_db(db_path: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("VACUUM", [])?;
    Ok(())
}

pub fn get_setting(db_path: &str, key: &str) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(db_path: &str, key: &str, value: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value)
         VALUES (?, ?)",
        params![key, value],
    )?;
    Ok(())
}

pub fn delete_setting(db_path: &str, key: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM settings WHERE key = ?", params![key])?;
    Ok(())
}

pub fn get_db_stats(db_path: &str) -> Result<i64> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM videos")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}
