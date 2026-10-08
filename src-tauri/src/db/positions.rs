//! Where the reader stopped in each saved video, so opening it again can offer to resume there (the sidebar), and which
//! videos they've watched. Both are the reader's own, like a pin: allowed in a read-only workspace, and not part of a
//! Kinpak. A position is forgotten when the video plays to its end or is marked completed; both go with the video.
//! The pin menu lists them: Continue Watching (started, not finished) and Watched.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

/// Creates the table (called from init_db). STRICT, like every table here; a deleted video takes its row with it.
pub fn ensure_positions_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS VideoPositions (
            video_id TEXT PRIMARY KEY,
            seconds REAL NOT NULL,
            duration REAL,
            updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterDEL_VideoPositions
        AFTER DELETE ON Videos
        BEGIN
            DELETE FROM VideoPositions WHERE video_id = OLD.video_id;
        END;
        CREATE TABLE IF NOT EXISTS VideoWatched (
            video_id TEXT PRIMARY KEY,
            watched_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterDEL_VideoWatched
        AFTER DELETE ON Videos
        BEGIN
            DELETE FROM VideoWatched WHERE video_id = OLD.video_id;
        END;",
    )
}

/// Where a video was left: the second it stopped at, and how long it is (when the player said).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoPosition {
    pub seconds: f64,
    pub duration: Option<f64>,
}

pub fn get_video_position(db_path: &str, video_id: &str) -> Result<Option<VideoPosition>> {
    let conn = Connection::open(db_path)?;
    conn.query_row(
        "SELECT seconds, duration FROM VideoPositions WHERE video_id = ?1",
        params![video_id],
        |r| Ok(VideoPosition { seconds: r.get(0)?, duration: r.get(1)? }),
    )
    .optional()
}

/// Records where a saved video was left. A position of 0 or less forgets it (the video played to its end, or was
/// started over). A video not in the library is left alone.
pub fn set_video_position(db_path: &str, video_id: &str, seconds: f64, duration: Option<f64>) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if !seconds.is_finite() || seconds <= 0.0 {
        conn.execute("DELETE FROM VideoPositions WHERE video_id = ?1", params![video_id])?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO VideoPositions (video_id, seconds, duration, updated_at)
         SELECT ?1, ?2, ?3, strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE EXISTS (SELECT 1 FROM Videos WHERE video_id = ?1)
         ON CONFLICT(video_id) DO UPDATE SET seconds = excluded.seconds, duration = COALESCE(excluded.duration, duration),
                                            updated_at = excluded.updated_at",
        params![video_id, seconds, duration.filter(|d| d.is_finite() && *d > 0.0)],
    )?;
    Ok(())
}

/// Positions this far in or more count as started (the sidebar offers Resume from the same point).
const STARTED_SECONDS: f64 = 15.0;

/// A video in the pin menu's Continue Watching or Watched lists.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListedVideo {
    pub video_id: String,
    pub title: String,
    pub author: String,
    /// Continue Watching: where it was left, and its length when known.
    pub seconds: Option<f64>,
    pub duration: Option<f64>,
    /// When it was last watched (Continue Watching) or finished (Watched).
    pub at: String,
}

/// Continue Watching: saved videos started (past the first few seconds) and not finished, the most recent first.
pub fn list_continue_watching(db_path: &str) -> Result<Vec<ListedVideo>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT p.video_id, IFNULL(v.title, ''), IFNULL(v.author, ''), p.seconds, p.duration, p.updated_at
         FROM VideoPositions p JOIN Videos v ON v.video_id = p.video_id
         WHERE p.seconds >= ?1
         ORDER BY p.updated_at DESC",
    )?;
    let rows = stmt.query_map(params![STARTED_SECONDS], |r| {
        Ok(ListedVideo { video_id: r.get(0)?, title: r.get(1)?, author: r.get(2)?, seconds: r.get(3)?, duration: r.get(4)?, at: r.get(5)? })
    })?;
    rows.collect()
}

/// Watched: every saved video marked watched, the most recently finished first.
pub fn list_watched(db_path: &str) -> Result<Vec<ListedVideo>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT w.video_id, IFNULL(v.title, ''), IFNULL(v.author, ''), w.watched_at
         FROM VideoWatched w JOIN Videos v ON v.video_id = w.video_id
         ORDER BY w.watched_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ListedVideo { video_id: r.get(0)?, title: r.get(1)?, author: r.get(2)?, seconds: None, duration: None, at: r.get(3)? })
    })?;
    rows.collect()
}

/// Marks a saved video watched (or, with `watched` false, not). Watched, its position is forgotten: there's nothing left
/// to resume. A video not in the library is left alone.
pub fn set_video_watched(db_path: &str, video_id: &str, watched: bool) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if !watched {
        conn.execute("DELETE FROM VideoWatched WHERE video_id = ?1", params![video_id])?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO VideoWatched (video_id, watched_at)
         SELECT ?1, strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE EXISTS (SELECT 1 FROM Videos WHERE video_id = ?1)
         ON CONFLICT(video_id) DO UPDATE SET watched_at = excluded.watched_at",
        params![video_id],
    )?;
    conn.execute("DELETE FROM VideoPositions WHERE video_id = ?1", params![video_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_position_is_kept_until_the_video_ends_or_goes() {
        let path = std::env::temp_dir()
            .join(format!("kinesis_positions_{}_{}.db", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
            .to_string_lossy()
            .to_string();
        crate::db::init_db(&path).unwrap();
        crate::db::save_video(&path, "v1", "T", "A", 600, "words", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();

        set_video_position(&path, "v1", 125.5, Some(600.0)).unwrap();
        assert_eq!(get_video_position(&path, "v1").unwrap(), Some(VideoPosition { seconds: 125.5, duration: Some(600.0) }));
        // A later report without the length keeps the length it had.
        set_video_position(&path, "v1", 200.0, None).unwrap();
        assert_eq!(get_video_position(&path, "v1").unwrap(), Some(VideoPosition { seconds: 200.0, duration: Some(600.0) }));
        // Played to the end: forgotten.
        set_video_position(&path, "v1", 0.0, None).unwrap();
        assert_eq!(get_video_position(&path, "v1").unwrap(), None);
        // Not in the library: nothing kept.
        set_video_position(&path, "nope", 50.0, None).unwrap();
        assert_eq!(get_video_position(&path, "nope").unwrap(), None);
        // Gone with the video.
        set_video_position(&path, "v1", 30.0, None).unwrap();
        Connection::open(&path).unwrap().execute("DELETE FROM Videos WHERE video_id = 'v1'", []).unwrap();
        let left: i64 = Connection::open(&path).unwrap().query_row("SELECT COUNT(*) FROM VideoPositions", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn marking_watched_moves_a_video_from_continue_watching_to_watched() {
        let path = std::env::temp_dir()
            .join(format!("kinesis_watched_{}_{}.db", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
            .to_string_lossy()
            .to_string();
        crate::db::init_db(&path).unwrap();
        for id in ["v1", "v2"] {
            crate::db::save_video(&path, id, id, "A", 600, "words", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
        }
        set_video_position(&path, "v1", 120.0, Some(600.0)).unwrap();
        set_video_position(&path, "v2", 5.0, Some(600.0)).unwrap();
        let ids = |list: Vec<ListedVideo>| list.into_iter().map(|v| v.video_id).collect::<Vec<_>>();
        assert_eq!(ids(list_continue_watching(&path).unwrap()), ["v1"], "the first few seconds don't count as started");
        set_video_watched(&path, "v1", true).unwrap();
        assert!(list_continue_watching(&path).unwrap().is_empty());
        assert_eq!(ids(list_watched(&path).unwrap()), ["v1"]);
        set_video_watched(&path, "v1", false).unwrap();
        assert!(list_watched(&path).unwrap().is_empty());
    }
}
