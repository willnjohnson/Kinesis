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
            summary TEXT,
            view_count INTEGER DEFAULT 0,
            video_type TEXT DEFAULT 'standard',
            published_at TEXT,
            date_added DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    let mut needs_migration = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(videos)")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            let col_type: String = row.get(2)?;
            if name == "view_count" && col_type.to_uppercase() == "TEXT" {
                needs_migration = true;
                break;
            }
        }
    }

    if needs_migration {
        conn.execute_batch(
            "BEGIN TRANSACTION;
             ALTER TABLE videos RENAME TO videos_old;
             CREATE TABLE videos (
                 video_id TEXT PRIMARY KEY,
                 title TEXT,
                 author TEXT,
                 handle TEXT,
                 length_seconds INTEGER,
                 transcript TEXT,
                 summary TEXT,
                 view_count INTEGER DEFAULT 0,
                 video_type TEXT DEFAULT 'standard',
                 published_at TEXT,
                 date_added DATETIME DEFAULT CURRENT_TIMESTAMP
             );
             INSERT INTO videos (video_id, title, author, handle, length_seconds, transcript, summary, view_count, video_type, published_at, date_added)
             SELECT video_id, title, author, handle, length_seconds, transcript, NULL, CAST(view_count AS INTEGER), video_type, published_at, date_added
             FROM videos_old;
             DROP TABLE videos_old;
             COMMIT;"
        )?;
    } else {
        // Add summary column if it doesn't exist (for existing databases)
        let column_exists: Result<i64, _> = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name='summary'",
            [],
            |row| row.get(0),
        );
        if let Ok(0) = column_exists {
            conn.execute(
                "ALTER TABLE videos ADD COLUMN summary TEXT",
                [],
            )?;
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS search_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            query       TEXT NOT NULL,
            searched_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            UNIQUE(query)
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
        let view_count_str = match row.get::<_, Option<i64>>(4) {
            Ok(Some(0)) | Ok(None) => "Saved".to_string(),
            Ok(Some(n)) => n.to_string(),
            Err(_) => {
                match row.get::<_, Option<String>>(4) {
                    Ok(Some(ref s)) if s == "0" => "Saved".to_string(),
                    Ok(Some(s)) => s,
                    _ => "Saved".to_string(),
                }
            }
        };
        Ok(Video {
            id: row.get::<_, String>(0).unwrap_or_default(),
            title: row.get::<_, Option<String>>(1).unwrap_or(None).unwrap_or_else(|| "Unknown".to_string()),
            author: row.get::<_, Option<String>>(2).unwrap_or(None),
            length_seconds: match row.get::<_, Option<i32>>(3) {
                Ok(v) => v,
                Err(_) => row.get::<_, Option<String>>(3).unwrap_or(None).and_then(|s| s.parse().ok()),
            },
            view_count: view_count_str,
            thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", row.get::<_, String>(0).unwrap_or_default()),
            published_at: row.get::<_, Option<String>>(5).unwrap_or(None).unwrap_or_else(|| "".to_string()),
            status: Some("saved".to_string()),
            date_added: row.get::<_, Option<String>>(6).unwrap_or(None),
            handle: row.get::<_, Option<String>>(7).unwrap_or(None),
            video_type: row.get::<_, Option<String>>(8).unwrap_or(None),
        })
    })?;

    let mut videos = Vec::new();
    for video in video_iter {
        videos.push(video?);
    }
    Ok(videos)
}

pub fn save_video(db_path: &str, video_id: &str, title: &str, author: &str, length: i32, transcript: &str, view_count: i64, published_at: &str, handle: &str, video_type: &str) -> Result<()> {
    let video_id = video_id.trim();
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
    let video_id = video_id.trim();
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT transcript FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn get_video_full(db_path: &str, video_id: &str) -> Result<Option<(String, String, String, i32, String, i64, String, String, String)>> {
     let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT video_id, title, author, length_seconds, transcript, view_count, published_at, handle, video_type FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some((
            row.get::<_, String>(0).unwrap_or_default(),
            row.get::<_, Option<String>>(1).unwrap_or(None).unwrap_or_else(|| "Unknown".to_string()),
            row.get::<_, Option<String>>(2).unwrap_or(None).unwrap_or_else(|| "Unknown".to_string()),
            match row.get::<_, Option<i32>>(3) {
                Ok(Some(v)) => v,
                Err(_) => row.get::<_, Option<String>>(3).unwrap_or(None).and_then(|s| s.parse().ok()).unwrap_or(0),
                _ => 0,
            },
            row.get::<_, Option<String>>(4).unwrap_or(None).unwrap_or_else(|| "".to_string()),
            match row.get::<_, Option<i64>>(5) {
                Ok(Some(n)) => n,
                Err(_) => match row.get::<_, Option<String>>(5) {
                    Ok(Some(s)) => s.parse::<i64>().unwrap_or(0),
                    _ => 0,
                },
                _ => 0,
            },
            row.get::<_, Option<String>>(6).unwrap_or(None).unwrap_or_else(|| "".to_string()),
            row.get::<_, Option<String>>(7).unwrap_or(None).unwrap_or_else(|| "".to_string()),
            row.get::<_, Option<String>>(8).unwrap_or(None).unwrap_or_else(|| "standard".to_string())
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

pub fn get_history_stats(db_path: &str) -> Result<i64> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM search_history")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}

pub fn save_summary(db_path: &str, video_id: &str, summary: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE videos SET summary = ?1 WHERE video_id = ?2",
        params![summary, video_id],
    )?;
    Ok(())
}

pub fn get_summary(db_path: &str, video_id: &str) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT summary FROM videos WHERE video_id = ?")?;
    let mut rows = stmt.query(params![video_id])?;
    if let Some(row) = rows.next()? {
        Ok(row.get(0)?)
    } else {
        Ok(None)
    }
}

pub fn get_summarized_count(db_path: &str) -> Result<i64> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM videos WHERE summary IS NOT NULL AND summary != ''")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}

pub fn get_videos_with_summaries(db_path: &str) -> Result<Vec<String>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT video_id FROM videos WHERE summary IS NOT NULL AND summary != ''")?;
    let mut rows = stmt.query([])?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next()? {
        ids.push(row.get(0)?);
    }
    Ok(ids)
}
