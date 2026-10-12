//! Orphaned videos: saved videos YouTube no longer has (removed, or the ID leads nowhere). They stay in the library for
//! the record, listed in the Library's Orphaned window (components/OrphanedModal.tsx), where they can be deleted. A video
//! is found orphaned when it's opened in the sidebar (commands/orphans.rs asks YouTube about it), and stops being one if
//! it ever answers again. Also here: a renamed video's title catching up with YouTube.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

/// Creates the table (called from init_db). STRICT, like every table here; a deleted video takes its row with it.
pub fn ensure_orphans_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS OrphanedVideos (
            video_id TEXT PRIMARY KEY,
            reason TEXT NOT NULL DEFAULT '',
            found_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterDEL_OrphanedVideos
        AFTER DELETE ON Videos
        BEGIN
            DELETE FROM OrphanedVideos WHERE video_id = OLD.video_id;
        END;",
    )
}

/// An orphaned video as the Orphaned window lists it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanedVideo {
    pub video_id: String,
    pub title: String,
    pub author: String,
    /// What YouTube said ("Video unavailable").
    pub reason: String,
    pub found_at: String,
}

/// The orphaned videos, the most recently found first.
pub fn list_orphaned(db_path: &str) -> Result<Vec<OrphanedVideo>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT o.video_id, IFNULL(v.title, ''), IFNULL(v.author, ''), o.reason, o.found_at
         FROM OrphanedVideos o JOIN Videos v ON v.video_id = o.video_id
         ORDER BY o.found_at DESC, o.rowid DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(OrphanedVideo { video_id: r.get(0)?, title: r.get(1)?, author: r.get(2)?, reason: r.get(3)?, found_at: r.get(4)? })
    })?;
    rows.collect()
}

/// Marks a saved video orphaned (or, with `orphaned` false, not). A video not in the library is left alone.
pub fn set_orphaned(db_path: &str, video_id: &str, orphaned: bool, reason: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if !orphaned {
        conn.execute("DELETE FROM OrphanedVideos WHERE video_id = ?1", params![video_id])?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO OrphanedVideos (video_id, reason, found_at)
         SELECT ?1, ?2, strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE EXISTS (SELECT 1 FROM Videos WHERE video_id = ?1)
         ON CONFLICT(video_id) DO UPDATE SET reason = excluded.reason",
        params![video_id, reason.trim()],
    )?;
    Ok(())
}

/// A saved video's title, and the stored title it replaced when YouTube's differs (None when it's the same, or the
/// video isn't saved).
pub fn update_video_title(db_path: &str, video_id: &str, title: &str) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    let old: Option<String> = conn
        .query_row("SELECT IFNULL(title, '') FROM Videos WHERE video_id = ?1", params![video_id], |r| r.get(0))
        .optional()?;
    let (Some(old), title) = (old, title.trim()) else { return Ok(None) };
    if title.is_empty() || old.trim() == title {
        return Ok(None);
    }
    conn.execute("UPDATE Videos SET title = ?1 WHERE video_id = ?2", params![title, video_id])?;
    Ok(Some(old))
}

/// A saved video's view count catching up with YouTube's: stored when it differs, and returned then (None when it's
/// the same, or the video isn't saved). A count of zero or less is no answer (YouTube gave none), and changes nothing.
pub fn update_video_view_count(db_path: &str, video_id: &str, views: i64) -> Result<Option<i64>> {
    if views <= 0 {
        return Ok(None);
    }
    let conn = Connection::open(db_path)?;
    let old: Option<i64> = conn
        .query_row("SELECT IFNULL(view_count, 0) FROM Videos WHERE video_id = ?1", params![video_id], |r| r.get(0))
        .optional()?;
    if old.is_none() || old == Some(views) {
        return Ok(None);
    }
    conn.execute("UPDATE Videos SET view_count = ?1 WHERE video_id = ?2", params![views, video_id])?;
    Ok(Some(views))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(name: &str) -> String {
        let path = std::env::temp_dir()
            .join(format!("kinesis_orphans_{name}_{}_{}.db", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
            .to_string_lossy()
            .to_string();
        crate::db::init_db(&path).unwrap();
        crate::db::save_video(&path, "v1", "Old Title", "Someone", 60, "words", 1, "2026-01-01T00:00:00Z", "@someone", None).unwrap();
        path
    }

    #[test]
    fn orphaned_videos_are_listed_until_they_answer_again_or_are_deleted() {
        let path = db("list");
        set_orphaned(&path, "v1", true, "Video unavailable").unwrap();
        set_orphaned(&path, "not-saved", true, "Video unavailable").unwrap();
        let listed = list_orphaned(&path).unwrap();
        assert_eq!(listed.iter().map(|o| (o.video_id.as_str(), o.title.as_str())).collect::<Vec<_>>(), [("v1", "Old Title")]);
        set_orphaned(&path, "v1", false, "").unwrap();
        assert!(list_orphaned(&path).unwrap().is_empty());
        set_orphaned(&path, "v1", true, "Video unavailable").unwrap();
        Connection::open(&path).unwrap().execute("DELETE FROM Videos WHERE video_id = 'v1'", []).unwrap();
        let left: i64 = Connection::open(&path).unwrap().query_row("SELECT COUNT(*) FROM OrphanedVideos", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_renamed_title_is_taken_over_and_the_old_one_said() {
        let path = db("title");
        assert_eq!(update_video_title(&path, "v1", "Old Title").unwrap(), None);
        assert_eq!(update_video_title(&path, "v1", "New Title").unwrap(), Some("Old Title".to_string()));
        let now: String = Connection::open(&path).unwrap().query_row("SELECT title FROM Videos WHERE video_id = 'v1'", [], |r| r.get(0)).unwrap();
        assert_eq!(now, "New Title");
        assert_eq!(update_video_title(&path, "missing", "X").unwrap(), None);
    }

    #[test]
    fn a_view_count_catches_up_only_when_it_differs() {
        let path = db("views");
        // Saved with 1 view.
        assert_eq!(update_video_view_count(&path, "v1", 1).unwrap(), None);
        assert_eq!(update_video_view_count(&path, "v1", 0).unwrap(), None);
        assert_eq!(update_video_view_count(&path, "v1", 2500).unwrap(), Some(2500));
        let now: i64 = Connection::open(&path).unwrap().query_row("SELECT view_count FROM Videos WHERE video_id = 'v1'", [], |r| r.get(0)).unwrap();
        assert_eq!(now, 2500);
        assert_eq!(update_video_view_count(&path, "missing", 10).unwrap(), None);
    }
}
