//! Pinned videos: the reader's own short list of what they're working on now, reached from the title bar's pin menu from
//! any view (components/PinsMenu.tsx). A pin is a personal marker, like a Calendar check-off or an Essential tag, so it's
//! allowed in a read-only workspace; and it's not part of a Kinpak (kinpak.rs leaves this table out).

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

/// Creates the table (called from init_db). STRICT, like every table here; a deleted video takes its pin with it.
pub fn ensure_pins_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS PinnedVideos (
            video_id TEXT PRIMARY KEY,
            pinned_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterDEL_PinnedVideos
        AFTER DELETE ON Videos
        BEGIN
            DELETE FROM PinnedVideos WHERE video_id = OLD.video_id;
        END;",
    )
}

/// A video as the pin menu lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuVideo {
    pub video_id: String,
    pub title: String,
    pub author: String,
}

fn invalid(msg: &str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.to_string())))
}

/// The pinned videos, newest pin first.
pub fn list_pins(db_path: &str) -> Result<Vec<MenuVideo>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT p.video_id, IFNULL(v.title, ''), IFNULL(v.author, '')
         FROM PinnedVideos p JOIN Videos v ON v.video_id = p.video_id
         ORDER BY p.pinned_at DESC, p.rowid DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok(MenuVideo { video_id: r.get(0)?, title: r.get(1)?, author: r.get(2)? }))?;
    rows.collect()
}

/// Pins or unpins a video. Only a video saved to the library can be pinned (the menu opens it from there).
pub fn set_pinned(db_path: &str, video_id: &str, pinned: bool) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if !pinned {
        conn.execute("DELETE FROM PinnedVideos WHERE video_id = ?1", params![video_id])?;
        return Ok(());
    }
    let saved = conn.query_row("SELECT 1 FROM Videos WHERE video_id = ?1", params![video_id], |_| Ok(())).optional()?.is_some();
    if !saved {
        return Err(invalid("Save this video to the library first, then pin it."));
    }
    conn.execute(
        "INSERT INTO PinnedVideos (video_id, pinned_at) VALUES (?1, strftime('%Y-%m-%d %H:%M:%f', 'now'))
         ON CONFLICT(video_id) DO NOTHING",
        params![video_id],
    )?;
    Ok(())
}

/// Unpins everything.
pub fn clear_pins(db_path: &str) -> Result<()> {
    Connection::open(db_path)?.execute("DELETE FROM PinnedVideos", [])?;
    Ok(())
}

/// The saved videos carrying `tag` (any case), newest saved first: an Essential tag's submenu in the pin menu.
pub fn list_videos_with_tag(db_path: &str, tag: &str) -> Result<Vec<MenuVideo>> {
    let wanted = tag.trim().to_lowercase();
    if wanted.is_empty() {
        return Ok(vec![]);
    }
    let conn = Connection::open(db_path)?;
    // Narrowed in SQL, then checked tag by tag (tags are a comma-separated list, so "Revisit" mustn't match "Revisit Later").
    let mut stmt = conn.prepare(
        "SELECT video_id, IFNULL(title, ''), IFNULL(author, ''), IFNULL(tags, '') FROM Videos
         WHERE instr(lower(IFNULL(tags, '')), ?1) > 0
         ORDER BY date_added DESC, video_id",
    )?;
    let rows = stmt.query_map(params![wanted], |r| {
        Ok((MenuVideo { video_id: r.get(0)?, title: r.get(1)?, author: r.get(2)? }, r.get::<_, String>(3)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (video, tags) = row?;
        if tags.split(',').any(|t| t.trim().to_lowercase() == wanted) {
            out.push(video);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> String {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("kinesis_pins_{}_{n}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();
        super::super::init_db(&p).unwrap();
        p
    }

    #[test]
    fn pins_list_newest_first_and_go_with_their_video() {
        let p = temp_db();
        let conn = Connection::open(&p).unwrap();
        conn.execute("INSERT INTO Videos (video_id, title, author, tags) VALUES ('a', 'A', 'Ann', 'Watch Later, Revisit Later'), ('b', 'B', 'Bo', 'revisit')", []).unwrap();
        set_pinned(&p, "a", true).unwrap();
        set_pinned(&p, "b", true).unwrap();
        set_pinned(&p, "a", true).unwrap(); // pinned again: stays where it was
        assert_eq!(list_pins(&p).unwrap().iter().map(|v| v.video_id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert!(set_pinned(&p, "unsaved", true).is_err());
        set_pinned(&p, "b", false).unwrap();
        assert_eq!(list_pins(&p).unwrap().len(), 1);
        conn.execute("DELETE FROM Videos WHERE video_id = 'a'", []).unwrap();
        assert!(list_pins(&p).unwrap().is_empty());
        set_pinned(&p, "b", true).unwrap();
        clear_pins(&p).unwrap();
        assert!(list_pins(&p).unwrap().is_empty());
        // A tag matches whole, in any case.
        assert_eq!(list_videos_with_tag(&p, "Revisit").unwrap().iter().map(|v| v.video_id.as_str()).collect::<Vec<_>>(), ["b"]);
    }
}
