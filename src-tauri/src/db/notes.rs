//! Notes: pages of the reader's own writing, the Notes section (docs/kinesis-design.tex, "Notes"). A note doesn't belong
//! to a video: it's study notes on a topic, and it *cites* videos, moments in them and passages of their transcripts and
//! summaries the way an essay cites sources. A citation is ordinary Markdown (a quote, then an in-app link to the video),
//! so renaming or deleting a video keeps citations tidy through the usual link editing (db/links.rs).
//!
//! Two tables of one shape: `Notes` (shared: they travel with the workspace in a Kinpak) and `PersonalNotes` (the
//! reader's own, like pins: never exported, and allowed in a read-only workspace). Kept apart rather than told apart by a
//! column, so no export can leak a personal note by missing a filter. A note's id is the same in either table, so moving
//! it between them (`set_note_shared`) keeps every link to it, and its places on Calendar tracks.

use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::glossary::{decode_drives, encode_drives, validated_drives};
use super::links::{apply_link_edits_recorded, LinkEdit, LinkKind, TextChange};

/// The shared notes' table, and the personal ones'.
pub const SHARED_NOTES: &str = "Notes";
pub const PERSONAL_NOTES: &str = "PersonalNotes";
const TABLES: [&str; 2] = [SHARED_NOTES, PERSONAL_NOTES];

/// The longest title a note can have.
pub const MAX_NOTE_TITLE: usize = 200;

fn invalid(msg: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.into())))
}

/// Creates the two tables (called from init_db, before the Calendar's, whose triggers name them). STRICT, like every
/// table here.
pub fn ensure_notes_schema(conn: &Connection) -> Result<()> {
    for table in TABLES {
        conn.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {table} (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                drives TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx{table}Updated ON {table}(updated_at);"
        ))?;
    }
    Ok(())
}

/// One note, as the Notes section shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// "" while it's Untitled.
    pub title: String,
    pub body: String,
    /// The Drives it's filed under, at any level, as a glossary term is (db/glossary.rs).
    pub drives: Vec<String>,
    /// Shared (in `Notes`), or the reader's own (in `PersonalNotes`).
    pub shared: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// A new note's id: 16 hex characters, random enough that two devices making notes never pick the same one.
fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hash = Sha256::new();
    hash.update(chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default().to_le_bytes());
    hash.update(std::process::id().to_le_bytes());
    hash.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hash.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// A title as it's stored: trimmed, on one line, at most MAX_NOTE_TITLE characters.
fn clean_title(title: &str) -> Result<String> {
    let one_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > MAX_NOTE_TITLE {
        return Err(invalid(format!("A note's title can be at most {MAX_NOTE_TITLE} characters.")));
    }
    Ok(one_line)
}

const COLUMNS: &str = "id, title, body, drives, created_at, updated_at";

fn read_note(table: &str, r: &rusqlite::Row) -> Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        drives: decode_drives(&r.get::<_, String>(3)?),
        shared: table == SHARED_NOTES,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

fn find(conn: &Connection, id: &str) -> Result<Option<Note>> {
    for table in TABLES {
        let found = conn
            .query_row(&format!("SELECT {COLUMNS} FROM {table} WHERE id = ?1"), params![id], |r| read_note(table, r))
            .optional()?;
        if found.is_some() {
            return Ok(found);
        }
    }
    Ok(None)
}

fn table_for(shared: bool) -> &'static str {
    if shared { SHARED_NOTES } else { PERSONAL_NOTES }
}

/// Every note, shared and personal, the most recently changed first.
pub fn list_notes(db_path: &str) -> Result<Vec<Note>> {
    let conn = Connection::open(db_path)?;
    let mut all = Vec::new();
    for table in TABLES {
        let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM {table}"))?;
        let rows = stmt.query_map([], |r| read_note(table, r))?;
        all.extend(rows.collect::<Result<Vec<_>>>()?);
    }
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    Ok(all)
}

pub fn get_note(db_path: &str, id: &str) -> Result<Option<Note>> {
    find(&Connection::open(db_path)?, id)
}

/// Makes a note: shared or personal, with whatever it starts with (all of it may be empty: a blank Untitled page).
pub fn create_note(db_path: &str, shared: bool, title: &str, body: &str, drives: &[String]) -> Result<Note> {
    let title = clean_title(title)?;
    let drives = validated_drives(drives)?;
    let conn = Connection::open(db_path)?;
    let (id, at) = (new_id(), now());
    conn.execute(
        &format!("INSERT INTO {} ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?5)", table_for(shared)),
        params![id, title, body, encode_drives(&drives), at],
    )?;
    find(&conn, &id)?.ok_or_else(|| invalid("The note wasn't saved."))
}

/// Saves a note's title, text and Drives, wherever it is.
pub fn update_note(db_path: &str, id: &str, title: &str, body: &str, drives: &[String]) -> Result<Note> {
    let title = clean_title(title)?;
    let drives = validated_drives(drives)?;
    let conn = Connection::open(db_path)?;
    let note = find(&conn, id)?.ok_or_else(|| invalid("That note doesn't exist any more."))?;
    conn.execute(
        &format!("UPDATE {} SET title = ?1, body = ?2, drives = ?3, updated_at = ?4 WHERE id = ?5", table_for(note.shared)),
        params![title, body, encode_drives(&drives), now(), id],
    )?;
    find(&conn, id)?.ok_or_else(|| invalid("That note doesn't exist any more."))
}

/// Adds `text` to the end of a note, after a blank line (what citing into a note does when the note isn't open).
pub fn append_to_note(db_path: &str, id: &str, text: &str) -> Result<Note> {
    let conn = Connection::open(db_path)?;
    let note = find(&conn, id)?.ok_or_else(|| invalid("That note doesn't exist any more."))?;
    let body = join_paragraphs(&note.body, text);
    conn.execute(
        &format!("UPDATE {} SET body = ?1, updated_at = ?2 WHERE id = ?3", table_for(note.shared)),
        params![body, now(), id],
    )?;
    find(&conn, id)?.ok_or_else(|| invalid("That note doesn't exist any more."))
}

/// `body` with `text` after it as a paragraph of its own. The frontend does the same (src/lib/notes.ts).
pub fn join_paragraphs(body: &str, text: &str) -> String {
    let body = body.trim_end();
    if body.is_empty() { text.trim().to_string() } else { format!("{body}\n\n{}", text.trim()) }
}

/// Makes a note shared or personal: it moves to the other table, keeping its id (so links and Calendar places keep
/// pointing at it). Deleted from the one before it's added to the other: the Calendar's triggers then let go of it and
/// take it back again, rather than reconnecting first and then letting go.
pub fn set_note_shared(db_path: &str, id: &str, shared: bool) -> Result<Note> {
    let mut conn = Connection::open(db_path)?;
    let note = find(&conn, id)?.ok_or_else(|| invalid("That note doesn't exist any more."))?;
    if note.shared == shared {
        return Ok(note);
    }
    let tx = conn.transaction()?;
    move_note(&tx, id, shared)?;
    tx.commit()?;
    find(&conn, id)?.ok_or_else(|| invalid("The note wasn't moved."))
}

/// set_note_shared's move, on a connection that's already in a transaction (a workbook shared with its notes,
/// db/workbooks.rs). A note that doesn't exist, or is already where it's wanted, is left alone.
pub(super) fn move_note(conn: &Connection, id: &str, shared: bool) -> Result<()> {
    let Some(note) = find(conn, id)? else { return Ok(()) };
    if note.shared == shared {
        return Ok(());
    }
    conn.execute(&format!("DELETE FROM {} WHERE id = ?1", table_for(note.shared)), params![id])?;
    conn.execute(
        &format!("INSERT INTO {} ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", table_for(shared)),
        params![note.id, note.title, note.body, encode_drives(&note.drives), note.created_at, now()],
    )?;
    Ok(())
}

/// Deletes a note, and turns links to it in other texts back into plain words. Returns the note and those texts as they
/// were (the Trash puts both back), or None when there was no such note.
pub fn delete_note_recorded(db_path: &str, id: &str) -> Result<Option<(Note, Vec<TextChange>)>> {
    let conn = Connection::open(db_path)?;
    let Some(note) = find(&conn, id)? else { return Ok(None) };
    conn.execute(&format!("DELETE FROM {} WHERE id = ?1", table_for(note.shared)), params![id])?;
    drop(conn);
    let changes = apply_link_edits_recorded(db_path, &[LinkEdit::Unlink(LinkKind::Note, id.to_string())])?;
    Ok(Some((note, changes)))
}

/// Puts a deleted note back as it was (the Trash). Refused when a note with its id exists again.
pub fn restore_note(db_path: &str, note: &Note) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if find(&conn, &note.id)?.is_some() {
        return Err(invalid("This note is already back, so the old copy can't be restored."));
    }
    conn.execute(
        &format!("INSERT INTO {} ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", table_for(note.shared)),
        params![note.id, note.title, note.body, encode_drives(&note.drives), note.created_at, note.updated_at],
    )?;
    Ok(())
}

/// What a note is called where only a name fits: its title, else "Untitled".
pub fn note_title(title: &str) -> String {
    if title.trim().is_empty() { "Untitled".to_string() } else { title.trim().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    fn temp_db(name: &str) -> String {
        let path = std::env::temp_dir().join(format!("kinesis_notes_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();
        init_db(&p).unwrap();
        p
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_note_is_made_saved_and_listed_newest_first() {
        let db = temp_db("basic");
        let a = create_note(&db, false, "", "", &[]).unwrap();
        assert_eq!((a.title.as_str(), a.shared, a.id.len()), ("", false, 16), "a blank, personal Untitled page");
        let b = create_note(&db, true, "  Das   Perfekt ", "Haben or sein.", &v(&[":GERMAN-CH2"])).unwrap();
        assert_eq!(b.title, "Das Perfekt", "one line, trimmed");
        assert_eq!(b.drives, v(&[":GERMAN-CH2"]), "a sub-Drive is fine");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let a = update_note(&db, &a.id, "Greetings", "Du or Sie.", &[]).unwrap();
        let listed: Vec<String> = list_notes(&db).unwrap().into_iter().map(|n| n.title).collect();
        assert_eq!(listed, v(&["Greetings", "Das Perfekt"]), "the one changed last comes first");
        assert!(update_note(&db, &a.id, "t", "b", &v(&[":A_B"])).is_err(), "a malformed Drive is refused");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn appending_adds_a_paragraph() {
        let db = temp_db("append");
        let n = create_note(&db, false, "", "", &[]).unwrap();
        let n = append_to_note(&db, &n.id, "> first\n").unwrap();
        assert_eq!(n.body, "> first");
        let n = append_to_note(&db, &n.id, "> second").unwrap();
        assert_eq!(n.body, "> first\n\n> second");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn moving_between_shared_and_personal_keeps_the_id_and_the_text() {
        let db = temp_db("move");
        let n = create_note(&db, false, "Mine", "words", &v(&[":GERMAN"])).unwrap();
        let shared = set_note_shared(&db, &n.id, true).unwrap();
        assert_eq!((shared.id.as_str(), shared.title.as_str(), shared.body.as_str(), shared.shared), (n.id.as_str(), "Mine", "words", true));
        let conn = Connection::open(&db).unwrap();
        let count = |t: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!((count(SHARED_NOTES), count(PERSONAL_NOTES)), (1, 0));
        set_note_shared(&db, &n.id, false).unwrap();
        assert_eq!((count(SHARED_NOTES), count(PERSONAL_NOTES)), (0, 1));
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn deleting_unlinks_it_and_restoring_puts_it_back() {
        let db = temp_db("delete");
        let target = create_note(&db, true, "Target", "", &[]).unwrap();
        let other = create_note(&db, false, "Other", &format!("See [the target](kinesis://note/{}).", target.id), &[]).unwrap();
        let (gone, changes) = delete_note_recorded(&db, &target.id).unwrap().unwrap();
        assert_eq!(get_note(&db, &other.id).unwrap().unwrap().body, "See the target.");
        assert_eq!(changes.len(), 1);
        restore_note(&db, &gone).unwrap();
        assert!(get_note(&db, &target.id).unwrap().unwrap().shared);
        assert!(restore_note(&db, &gone).is_err(), "it's back already");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn citations_follow_a_renamed_video() {
        let db = temp_db("citations");
        let n = create_note(&db, false, "", "> words\n> [Lecture](kinesis://video/abc123?t=12:34)", &[]).unwrap();
        apply_link_edits_recorded(&db, &[LinkEdit::Retarget(LinkKind::Video, "abc123".into(), "xyz789".into())]).unwrap();
        assert_eq!(get_note(&db, &n.id).unwrap().unwrap().body, "> words\n> [Lecture](kinesis://video/xyz789?t=12:34)", "the time is kept");
        let _ = std::fs::remove_file(&db);
    }
}
